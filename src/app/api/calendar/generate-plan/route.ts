import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

export async function POST(req: NextRequest) {
  try {
    const { client_id, weeks, posts_per_week, focus, agent_id } = await req.json()
    if (!client_id || !weeks || !posts_per_week) {
      return NextResponse.json({ error: 'client_id, weeks, posts_per_week required' }, { status: 400 })
    }

    const [
      { data: client },
      { data: knowledge },
      { data: keywords },
      { data: history },
      { data: existingPlan },
    ] = await Promise.all([
      supabase.from('client_profiles').select('*').eq('id', client_id).single(),
      supabase.from('client_knowledge').select('*').eq('client_id', client_id).maybeSingle(),
      supabase.from('keyword_banks').select('keyword,intent,funnel_stage,monthly_volume,difficulty,current_position,content_targeting_this,priority,opportunity_score').eq('client_id', client_id).order('opportunity_score', { ascending: false, nullsFirst: false }).limit(100),
      supabase.from('content_history').select('title,primary_keyword,url,published_at').eq('client_id', client_id).order('published_at', { ascending: false }).limit(40),
      supabase.from('content_calendar').select('title,primary_keyword,status,scheduled_date').eq('client_id', client_id).not('status', 'in', '("cancelled","published")'),
    ])

    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const totalPieces = weeks * posts_per_week
    const today = new Date()
    const kwLines = (keywords || []).map((k: any) =>
      `"${k.keyword}" | ${k.intent || '?'} | vol:${k.monthly_volume || '?'} | KD:${k.difficulty || '?'} | pos:${k.current_position || 'not ranking'} | targeting:${k.content_targeting_this || 'NOTHING'}`
    ).join('\n')

    const historyLines = (history || []).map((h: any) =>
      `"${h.title}" (${h.primary_keyword || '?'}) ${h.url || 'no url'}`
    ).join('\n')

    const existingLines = (existingPlan || []).map((e: any) =>
      `"${e.title}" (${e.primary_keyword || '?'}) -- ${e.status}`
    ).join('\n')

    const sitePageLines = (knowledge?.site_pages || []).map((p: any) =>
      `${p.url} -- "${p.title || ''}"`
    ).join('\n')

    const gsc = knowledge?.gsc_snapshot || {}
    const gscBlock = gsc.totals
      ? `Totals (28d): ${gsc.totals.clicks} clicks, ${gsc.totals.impressions} impressions, avg pos ${gsc.totals.avg_position}
Near-miss keywords: ${(gsc.near_miss || []).map((n: any) => `"${n.query}" #${n.position} (${n.impressions}imp)`).join(', ') || 'none'}
Low CTR pages: ${(gsc.low_ctr || []).map((l: any) => `${l.url} ${l.ctr}%`).join(', ') || 'none'}`
      : 'No GSC data available.'

    const prompt = `You are an expert SEO content strategist planning content for ${client.name}.

CLIENT:
${client.description || ''}
Customer: ${(client as any).icp || 'not specified'}
USP: ${(client as any).usp || 'not specified'}
Goals: ${(client as any).content_goals || 'not specified'}
${(client as any).location_info ? `Location: ${(client as any).location_info}` : ''}

LIVE SITE PAGES (do not plan content that duplicates these):
${sitePageLines || 'No crawl data'}

GSC PERFORMANCE:
${gscBlock}

KEYWORD BANK (targeting:NOTHING means genuinely untargeted):
${kwLines || 'Empty'}

PUBLISHED CONTENT HISTORY:
${historyLines || 'None'}

ALREADY PLANNED (do not duplicate):
${existingLines || 'None'}

TASK:
Create a ${weeks}-week content plan of exactly ${totalPieces} pieces (${posts_per_week} per week), starting ${today.toISOString().split('T')[0]}.
${focus ? `Focus area: ${focus}` : 'Focus on the highest-opportunity gaps.'}

Sequencing rules:
1. Fastest ranking wins first (near-miss keywords with no dedicated page, low KD untargeted keywords)
2. Hub/pillar pages before supporting content
3. Commercial intent before informational
4. Never plan a piece that duplicates a live page or already-planned item
5. Spread publish dates evenly: ${posts_per_week} per week, weekdays only (Mon-Fri)

Respond with ONLY a JSON object, no markdown fences, no preamble:
{
  "summary": "2-3 sentence explanation of your strategy and sequencing logic",
  "entries": [
    {
      "title": "Working title",
      "primary_keyword": "target keyword",
      "content_type": "blog_post | pillar_page | category_page | local_seo",
      "scheduled_date": "YYYY-MM-DD",
      "priority": 1,
      "rationale": "One sentence: why this piece, why this position in the sequence",
      "notes": "Angle or approach in one sentence"
    }
  ]
}`

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!aiRes.ok) {
      const errText = await aiRes.text()
      return NextResponse.json({ error: `AI call failed: ${errText.slice(0, 200)}` }, { status: 500 })
    }

    const aiData = await aiRes.json()
    const raw = (aiData.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()

    let parsed: { summary: string; entries: any[] }
    try {
      const clean = raw.replace(/```json|```/g, '').trim()
      parsed = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'AI returned invalid JSON', raw: raw.slice(0, 500) }, { status: 500 })
    }

    if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
      return NextResponse.json({ error: 'No entries in plan' }, { status: 500 })
    }

    const VALID_TYPES = ['blog_post', 'pillar_page', 'category_page', 'local_seo']
    const inserts = parsed.entries
      .filter((e: any) => e.title && e.primary_keyword)
      .map((e: any) => ({
        client_id,
        workspace_id: (client as any).workspace_id,
        agent_id: agent_id || null,
        title: String(e.title).slice(0, 200),
        primary_keyword: String(e.primary_keyword).slice(0, 120),
        content_type: VALID_TYPES.includes(e.content_type) ? e.content_type : 'blog_post',
        scheduled_date: e.scheduled_date || null,
        priority: Math.min(3, Math.max(1, Math.round(e.priority || 2))),
        rationale: e.rationale ? String(e.rationale).slice(0, 500) : null,
        notes: e.notes ? String(e.notes).slice(0, 500) : null,
        status: 'planned',
      }))

    const { data: created, error: insertError } = await supabase
      .from('content_calendar')
      .insert(inserts)
      .select()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({
      summary: parsed.summary || '',
      created: created?.length || 0,
      entries: created,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
