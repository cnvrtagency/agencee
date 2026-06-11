import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

export async function POST(req: NextRequest) {
  const { automation_id, agent_id } = await req.json()
  if (!automation_id || !agent_id) {
    return NextResponse.json({ error: 'Missing automation_id or agent_id' }, { status: 400 })
  }

  const { data: automation } = await supabase
    .from('agent_automations')
    .select('*')
    .eq('id', automation_id)
    .single()

  if (!automation) {
    return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
  }

  // Load all clients for this workspace so automation handlers can pick the right one
  const { data: clients } = await supabase
    .from('client_profiles')
    .select('id, name, website, competitors, workspace_id')
    .order('name')

  const clientList = clients || []

  let summary = ''

  try {
    switch (automation.automation_type) {

      case 'weekly_keyword_scan': {
        const results: string[] = []
        for (const client of clientList.slice(0, 5)) {
          const { data: keywords } = await supabase
            .from('keyword_banks')
            .select('keyword, monthly_volume, difficulty, current_position, content_targeting_this, opportunity_score')
            .eq('client_id', client.id)
            .is('content_targeting_this', null)
            .order('opportunity_score', { ascending: false, nullsFirst: false })
            .limit(10)

          if (keywords && keywords.length > 0) {
            const top = keywords[0]
            results.push(`${client.name}: ${keywords.length} untargeted keywords. Top opportunity: "${top.keyword}" (vol: ${top.monthly_volume || '?'}, KD: ${top.difficulty || '?'}, pos: ${top.current_position || 'not ranking'})`)

            await supabase.from('briefing_items').upsert({
              client_id: client.id,
              workspace_id: client.workspace_id || null,
              type: 'opportunity',
              title: `Keyword gap: "${top.keyword}"`,
              body: `${keywords.length} untargeted keywords found. Top opportunity: "${top.keyword}" — ${top.monthly_volume || '?'} searches/month, KD ${top.difficulty || '?'}${top.current_position ? `, currently ranking #${Math.round(top.current_position)}` : ', not ranking'}. No content targeting this keyword yet.`,
              priority: top.opportunity_score || 50,
              dismissed: false,
            }, { onConflict: 'client_id,title' })
          }
        }
        summary = results.length > 0
          ? results.join(' | ')
          : 'All keywords in the bank have content targeting them.'
        break
      }

      case 'gsc_review': {
        const { data: connections } = await supabase
          .from('google_connections')
          .select('id, client_id')
          .in('status', ['active', 'connected'])

        if (!connections?.length) {
          summary = 'No active GSC connections. Connect Google Search Console from the client Connections tab.'
          break
        }

        const synced: string[] = []
        for (const conn of connections) {
          const res = await fetch(`${BASE_URL}/api/gsc/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connection_id: conn.id }),
          })
          const data = await res.json()
          const client = clientList.find(c => c.id === conn.client_id)
          if (res.ok && client) {
            synced.push(`${client.name} (${data.briefing_items || 0} briefing items created)`)
          }
        }
        summary = synced.length > 0
          ? `GSC synced: ${synced.join(', ')}`
          : 'GSC sync attempted but no data returned.'
        break
      }

      case 'internal_link_audit': {
        const results: string[] = []
        for (const client of clientList.slice(0, 5)) {
          const { data: pages } = await supabase
            .from('site_pages')
            .select('url, title, internal_links, word_count')
            .eq('client_id', client.id)

          if (!pages?.length) continue

          const orphans = pages.filter((p: any) => {
            const links = Array.isArray(p.internal_links) ? p.internal_links : []
            return links.length < 2 && (p.word_count || 0) > 300
          })

          if (orphans.length > 0) {
            results.push(`${client.name}: ${orphans.length} pages with fewer than 2 internal links — ${orphans.slice(0, 3).map((p: any) => p.url).join(', ')}${orphans.length > 3 ? '...' : ''}`)

            await supabase.from('briefing_items').upsert({
              client_id: client.id,
              workspace_id: client.workspace_id || null,
              type: 'opportunity',
              title: `Internal link gaps: ${orphans.length} underlinked pages`,
              body: `${orphans.length} pages have fewer than 2 internal links pointing to them. These pages are losing link equity. Top candidates: ${orphans.slice(0, 5).map((p: any) => p.url).join(', ')}`,
              priority: 40,
              dismissed: false,
            }, { onConflict: 'client_id,title' })
          }
        }
        summary = results.length > 0
          ? results.join(' | ')
          : 'Internal link audit complete. All crawled pages have sufficient internal links.'
        break
      }

      case 'site_audit': {
        const results: string[] = []
        for (const client of clientList.slice(0, 3)) {
          if (!client.website) continue

          const crawlRes = await fetch(`${BASE_URL}/api/crawl`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ website: client.website, client_id: client.id }),
          })
          const crawlData = await crawlRes.json()
          if (!crawlRes.ok) { results.push(`${client.name}: crawl failed`); continue }

          const { data: pages } = await supabase
            .from('site_pages')
            .select('url, title, h1, meta_description, word_count')
            .eq('client_id', client.id)

          if (!pages?.length) { results.push(`${client.name}: no pages found`); continue }

          const noMeta = pages.filter(p => !p.meta_description).length
          const noH1 = pages.filter(p => !p.h1).length
          const thin = pages.filter(p => (p.word_count || 0) < 300).length
          const issues = []
          if (noMeta > 0) issues.push(`${noMeta} missing meta descriptions`)
          if (noH1 > 0) issues.push(`${noH1} missing H1s`)
          if (thin > 0) issues.push(`${thin} thin pages (<300 words)`)

          const issueText = issues.length > 0 ? issues.join(', ') : 'no critical issues'
          results.push(`${client.name}: ${pages.length} pages crawled, ${issueText}`)

          if (issues.length > 0) {
            await supabase.from('briefing_items').upsert({
              client_id: client.id,
              workspace_id: client.workspace_id || null,
              type: 'opportunity',
              title: `Site audit: ${issues.length} issue type${issues.length > 1 ? 's' : ''} found`,
              body: `Site audit complete (${pages.length} pages). Issues: ${issues.join('; ')}. Review the Pages tab for details.`,
              priority: 60,
              dismissed: false,
            }, { onConflict: 'client_id,title' })
          }
        }
        summary = results.join(' | ') || 'Site audit complete.'
        break
      }

      case 'competitor_analysis': {
        const results: string[] = []
        for (const client of clientList.slice(0, 3)) {
          const { data: compSites } = await supabase
            .from('competitor_sites')
            .select('id, url, name')
            .eq('client_id', client.id)

          if (!compSites?.length) continue

          for (const comp of compSites) {
            const res = await fetch(`${BASE_URL}/api/crawl`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ client_id: client.id, competitor_id: comp.id }),
            })
            if (res.ok) {
              const data = await res.json()
              results.push(`${comp.name || comp.url} (${data.pages_crawled || 0} pages)`)
            }
          }
        }
        summary = results.length > 0
          ? `Competitor crawl complete: ${results.join(', ')}`
          : 'No competitor sites configured. Add competitors in the client Competitors tab.'
        break
      }

      case 'monthly_content_plan': {
        const results: string[] = []
        for (const client of clientList.slice(0, 3)) {
          const res = await fetch(`${BASE_URL}/api/calendar/generate-plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: client.id,
              weeks: 4,
              posts_per_week: 2,
              agent_id: automation.agent_id,
            }),
          })
          const data = await res.json()
          if (res.ok && data.created > 0) {
            results.push(`${client.name}: ${data.created} items planned`)
          }
        }
        summary = results.length > 0
          ? `Content plans generated: ${results.join(', ')}`
          : 'Monthly content plan complete. No new items added (plans may already exist).'
        break
      }

      default:
        return NextResponse.json({ error: `Unknown automation type: ${automation.automation_type}` }, { status: 400 })
    }

    return NextResponse.json({ ok: true, summary })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Automation failed' }, { status: 500 })
  }
}
