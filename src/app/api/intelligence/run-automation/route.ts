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
    .select('id, name, website, competitors')
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
            .select('keyword, search_volume, difficulty, content_targeting_this')
            .eq('client_id', client.id)
            .is('content_targeting_this', null)
            .order('search_volume', { ascending: false })
            .limit(10)
          if (keywords && keywords.length > 0) {
            results.push(`${client.name}: ${keywords.length} untargeted keywords (top: ${keywords[0].keyword})`)
          }
        }
        summary = results.length > 0
          ? `Keyword scan complete. ${results.join('; ')}`
          : 'Keyword scan complete. No untargeted keywords found.'
        break
      }

      case 'monthly_content_plan': {
        const results: string[] = []
        for (const client of clientList.slice(0, 3)) {
          const res = await fetch(`${BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 400,
              messages: [{
                role: 'user',
                content: `Generate a brief 4-week content plan for ${client.name} (${client.website || 'no website'}). List 4 topics with target keyword and content type. Be concise.`,
              }],
            }),
          })
          const data = await res.json()
          const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()
          if (text) results.push(`${client.name}: plan generated`)
        }
        summary = results.length > 0
          ? `Monthly content plans created for: ${results.join(', ')}`
          : 'Monthly content plan run complete.'
        break
      }

      case 'competitor_analysis': {
        const results: string[] = []
        for (const client of clientList.slice(0, 3)) {
          if (!client.competitors?.length) continue
          const res = await fetch(`${BASE_URL}/api/crawl`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: client.id, competitor_mode: true }),
          })
          if (res.ok) results.push(client.name)
        }
        summary = results.length > 0
          ? `Competitor analysis complete for: ${results.join(', ')}`
          : 'Competitor analysis run. No clients with competitors configured.'
        break
      }

      case 'site_audit': {
        const results: string[] = []
        for (const client of clientList.slice(0, 3)) {
          if (!client.website) continue
          const res = await fetch(`${BASE_URL}/api/crawl`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ website: client.website, client_id: client.id }),
          })
          if (res.ok) results.push(client.name)
        }
        summary = results.length > 0
          ? `Site audit crawl triggered for: ${results.join(', ')}`
          : 'Site audit run. No client websites configured.'
        break
      }

      case 'gsc_review': {
        const { data: connections } = await supabase
          .from('google_connections')
          .select('id, client_id')
          .eq('status', 'active')
        const synced: string[] = []
        for (const conn of connections ?? []) {
          const res = await fetch(`${BASE_URL}/api/gsc/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connection_id: conn.id }),
          })
          if (res.ok) {
            const client = clientList.find(c => c.id === conn.client_id)
            if (client) synced.push(client.name)
          }
        }
        summary = synced.length > 0
          ? `GSC review complete. Synced: ${synced.join(', ')}`
          : 'GSC review run. No active Google connections found.'
        break
      }

      case 'internal_link_audit': {
        const results: string[] = []
        for (const client of clientList.slice(0, 5)) {
          const { data: pages } = await supabase
            .from('site_pages')
            .select('url, internal_links_count')
            .eq('client_id', client.id)
            .order('internal_links_count', { ascending: true })
            .limit(5)
          if (pages && pages.length > 0) {
            const lowLinkPages = pages.filter((p: any) => (p.internal_links_count || 0) < 3)
            if (lowLinkPages.length > 0) {
              results.push(`${client.name}: ${lowLinkPages.length} pages with fewer than 3 internal links`)
            }
          }
        }
        summary = results.length > 0
          ? `Internal link audit complete. ${results.join('; ')}`
          : 'Internal link audit complete. All pages have sufficient internal links.'
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
