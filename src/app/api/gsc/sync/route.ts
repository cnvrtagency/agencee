import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getValidAccessToken } from '@/lib/gsc'
import { discoverKeywordsFromGSC } from '@/lib/gsc-keywords'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function fetchSitemap(baseUrl: string): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '')
  const candidates = [
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/sitemap`,
  ]

  function extractLocs(xml: string): string[] {
    const matches = xml.match(/<loc>([^<]+)<\/loc>/g) || []
    return matches.map(m => m.replace(/<\/?loc>/g, '').trim())
  }

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Agencee-Bot/1.0' },
        signal: AbortSignal.timeout(6000),
      })
      if (!res.ok) continue
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('xml') && !ct.includes('text')) continue
      const xml = await res.text()
      if (!xml.includes('<loc>')) continue

      const locs = extractLocs(xml)

      // Sitemap index — follow child sitemaps (one level deep)
      if (xml.includes('<sitemapindex') || xml.includes('<sitemap>')) {
        const childUrls: string[] = []
        for (const childUrl of locs.slice(0, 10)) {
          try {
            const childRes = await fetch(childUrl, {
              headers: { 'User-Agent': 'Agencee-Bot/1.0' },
              signal: AbortSignal.timeout(5000),
            })
            if (!childRes.ok) continue
            const childXml = await childRes.text()
            childUrls.push(...extractLocs(childXml))
          } catch { /* skip */ }
        }
        return childUrls.slice(0, 500)
      }

      return locs.slice(0, 500)
    } catch { /* try next */ }
  }
  return []
}

export async function POST(req: NextRequest) {
  try {
  const { connection_id, client_id } = await req.json().catch(() => ({}))

  let connQuery = supabase.from('google_connections').select('*').eq('status', 'active')
  if (connection_id) connQuery = connQuery.eq('id', connection_id) as any
  else if (client_id) connQuery = connQuery.eq('client_id', client_id) as any
  else return NextResponse.json({ error: 'connection_id or client_id required' }, { status: 400 })

  const { data: conn } = await connQuery.single()
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  let accessToken: string
  try {
    accessToken = await getValidAccessToken(conn.id)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 })
  }

  // Fetch Search Analytics for 3 periods in parallel
  // D-3 end date matches GSC's ~3-day processing lag; startDate computed from endDate for exact window
  const endDateMs = Date.now() - 3 * 86400000
  const endDate = new Date(endDateMs).toISOString().split('T')[0]

  async function gscPost(body: object) {
    const res = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(conn.property_url)}/searchAnalytics/query`,
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    )
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error?.message || `GSC API error`)
    return data
  }

  async function fetchPeriod(days: number): Promise<{ rows: any[]; totals: any; startDate: string; endDate: string }> {
    // startDate relative to endDate so the window is exactly `days` days
    const startDate = new Date(endDateMs - (days - 1) * 86400000).toISOString().split('T')[0]
    // Fetch both query-level rows AND no-dimension totals in parallel
    const [rowData, totalData] = await Promise.all([
      gscPost({ startDate, endDate, dimensions: ['query', 'page'], rowLimit: 1000 }),
      gscPost({ startDate, endDate, rowLimit: 1 }), // no dimensions = true aggregate totals
    ])
    return { rows: rowData.rows || [], totals: totalData.rows?.[0] ?? null, startDate, endDate }
  }

  const [p7, p28, p90] = await Promise.all([
    fetchPeriod(7),
    fetchPeriod(28),
    fetchPeriod(90),
  ])

  // Delete all existing rows for this client
  await supabase.from('search_performance').delete().eq('client_id', conn.client_id)

  // Insert rows + a __total__ aggregate row for accurate summary card numbers
  async function insertPeriodRows(rows: any[], totals: any, startDate: string, periodEnd: string) {
    const base = { client_id: conn.client_id, workspace_id: conn.workspace_id, period_start: startDate, period_end: periodEnd }
    const inserts: any[] = []
    // Aggregate total row (query='__total__') — true GSC totals unaffected by privacy thresholds
    if (totals) {
      inserts.push({ ...base, query: '__total__', page: '__total__', position: totals.position ?? 0, impressions: totals.impressions ?? 0, clicks: totals.clicks ?? 0, ctr: totals.ctr ?? 0 })
    }
    // Individual query rows
    for (const r of rows) {
      inserts.push({ ...base, query: r.keys[0], page: r.keys[1], position: r.position, impressions: r.impressions, clicks: r.clicks, ctr: r.ctr })
    }
    for (let i = 0; i < inserts.length; i += 500) {
      await supabase.from('search_performance').insert(inserts.slice(i, i + 500))
    }
  }

  await Promise.all([
    insertPeriodRows(p7.rows, p7.totals, p7.startDate, p7.endDate),
    insertPeriodRows(p28.rows, p28.totals, p28.startDate, p28.endDate),
    insertPeriodRows(p90.rows, p90.totals, p90.startDate, p90.endDate),
  ])

  // Use 28d data for keyword_banks and content_history updates (most balanced)
  const rows28 = p28.rows
  if (rows28.length > 0) {
    // Update content_history.ranking_position for matching URLs
    for (const row of rows28.slice(0, 100)) {
      await supabase.from('content_history')
        .update({ ranking_position: Math.round(row.position) })
        .eq('client_id', conn.client_id)
        .ilike('url', `%${row.keys[1].replace(/^https?:\/\/[^/]+/, '')}%`)
    }

    // Update opportunity scores in keyword_banks where keyword matches a query
    for (const row of rows28.slice(0, 100)) {
      await supabase.from('keyword_banks')
        .update({ current_position: Math.round(row.position) })
        .eq('client_id', conn.client_id)
        .ilike('keyword', row.keys[0])
    }
  }

  // Populate content_performance from 28d GSC data
  if (rows28.length > 0) {
    const now = new Date().toISOString()
    const perfRows = rows28.map((r: any) => ({
      workspace_id: conn.workspace_id,
      client_id: conn.client_id,
      url: r.keys[1],
      keyword: r.keys[0],
      impressions: r.impressions || 0,
      clicks: r.clicks || 0,
      position: Math.round(r.position) || 0,
      recorded_at: now,
    }))
    const perfBatch = 20
    for (let i = 0; i < perfRows.length; i += perfBatch) {
      await supabase.from('content_performance').insert(perfRows.slice(i, i + perfBatch))
    }
  }

  // ── GSC keyword discovery — combined deduped rows from all periods ────────────
  try {
    const allRowsMap: Record<string, any> = {}
    for (const r of [...p7.rows, ...p28.rows, ...p90.rows]) {
      const key = r.keys[0]
      if (!allRowsMap[key] || allRowsMap[key].impressions < r.impressions) allRowsMap[key] = r
    }
    await discoverKeywordsFromGSC(supabase, conn.client_id, conn.workspace_id, Object.values(allRowsMap))
  } catch { /* non-critical */ }

  // ── Section 6: Page-level and device breakdowns for 28d only ─────────────────
  try {
    const [pageData, deviceData] = await Promise.all([
      gscPost({ startDate: p28.startDate, endDate: p28.endDate, dimensions: ['page'], rowLimit: 200 }),
      gscPost({ startDate: p28.startDate, endDate: p28.endDate, dimensions: ['device'], rowLimit: 10 }),
    ])
    const pageBase = { client_id: conn.client_id, workspace_id: conn.workspace_id, period_start: p28.startDate, period_end: p28.endDate }
    const pageInserts: any[] = []
    for (const r of (pageData.rows || [])) {
      pageInserts.push({ ...pageBase, query: '__page__', page: r.keys[0], position: r.position, impressions: r.impressions, clicks: r.clicks, ctr: r.ctr })
    }
    for (const r of (deviceData.rows || [])) {
      pageInserts.push({ ...pageBase, query: '__device__', page: r.keys[0], position: r.position, impressions: r.impressions, clicks: r.clicks, ctr: r.ctr })
    }
    for (let i = 0; i < pageInserts.length; i += 500) {
      await supabase.from('search_performance').insert(pageInserts.slice(i, i + 500))
    }
  } catch { /* non-critical — skip on error */ }

  // ── Near-miss briefing_items (lowered thresholds) ──────────────────────────
  try {
    const rows28d = p28.rows
    const nearMisses = rows28d
      .filter((r: any) => r.position >= 3 && r.position <= 20 && r.impressions > 15)
      .sort((a: any, b: any) => b.impressions - a.impressions)
      .slice(0, 20)

    for (const kw of nearMisses) {
      const kwQuery = kw.keys[0]
      const { count } = await supabase
        .from('planned_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', conn.client_id)
        .ilike('primary_keyword', `%${kwQuery}%`)

      if (!count || count === 0) {
        await supabase.from('briefing_items').upsert({
          workspace_id: conn.workspace_id,
          client_id: conn.client_id,
          type: 'opportunity',
          title: `Near-miss: "${kwQuery}"`,
          body: `Ranking #${Math.round(kw.position)} with ${kw.impressions} impressions/month. Moving to page 1 could drive ~${Math.round(kw.impressions * 0.28)} additional clicks.`,
          action_label: 'Brief Ada',
          action_url: `/agents/seo?brief=${encodeURIComponent(kwQuery)}&position=${Math.round(kw.position)}&impressions=${kw.impressions}`,
          priority: Math.round(kw.impressions / 100),
          dismissed: false,
        }, { onConflict: 'workspace_id,client_id,title' })
      }
    }

    // Low-CTR opportunities
    const lowCtrOpps = rows28d.filter((r: any) =>
      r.position <= 10 && r.ctr < 0.03 && r.impressions > 30 && r.keys[0] !== '__total__'
    )
    for (const row of lowCtrOpps.slice(0, 10)) {
      await supabase.from('briefing_items').upsert({
        workspace_id: conn.workspace_id,
        client_id: conn.client_id,
        type: 'opportunity',
        title: `Low CTR: "${row.keys[0]}"`,
        body: `Ranking #${Math.round(row.position)} but only ${(row.ctr * 100).toFixed(1)}% CTR with ${row.impressions} impressions. Title tag or meta description likely needs improvement.`,
        action_label: 'Brief Ada',
        priority: Math.round(row.impressions / 50),
        dismissed: false,
      }, { onConflict: 'workspace_id,client_id,title' })
    }
  } catch { /* non-critical */ }

  // Fetch sitemap and store as site structure for Ada
  const sitemapUrls = await fetchSitemap(conn.property_url)
  if (sitemapUrls.length > 0) {
    // Load client to check if they have a GitHub repo (don't overwrite file tree if so)
    const { data: clientRow } = await supabase
      .from('client_profiles')
      .select('github_repo')
      .eq('id', conn.client_id)
      .single()

    if (!clientRow?.github_repo) {
      const sitemapText = `SITEMAP (${sitemapUrls.length} pages — last synced from GSC):\n` +
        sitemapUrls.map(u => {
          try { return new URL(u).pathname || '/' } catch { return u }
        }).join('\n')
      await supabase.from('client_profiles')
        .update({ file_tree: sitemapText })
        .eq('id', conn.client_id)
    }
  }

  // Update last_synced_at
  await supabase.from('google_connections').update({
    last_synced_at: new Date().toISOString(),
  }).eq('id', conn.id)

  // Count briefing items for this client
  const { count: briefingCount } = await supabase
    .from('briefing_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', conn.client_id)
    .eq('dismissed', false)

  return NextResponse.json({ synced: { '7d': p7.rows.length, '28d': p28.rows.length, '90d': p90.rows.length }, sitemap_urls: sitemapUrls.length, property: conn.property_url, date_range: `${p90.startDate} → ${endDate}`, page_rows_synced: true, briefing_items: briefingCount ?? 0 })
  } catch (err: any) {
    console.error('GSC sync error:', err)
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 })
  }
}
