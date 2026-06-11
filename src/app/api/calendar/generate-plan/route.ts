import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forbiddenResponse, requireUser, userCanAccessClient } from '@/lib/server/auth'
import { checkRateLimit, getRateLimitIdentity } from '@/lib/server/rate-limit'
import { readJsonWithLimit } from '@/lib/server/request-body'
import { checkUserBudget, recordTokenUsage } from '@/lib/server/token-usage'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const rate = checkRateLimit({
    key: `generate-plan:${getRateLimitIdentity(req, authResult.auth.user.id)}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  })
  if (!rate.ok) return rate.response

  try {
    const bodyResult = await readJsonWithLimit<any>(req, 64_000)
    if (!bodyResult.ok) return bodyResult.response
    const { client_id, weeks, posts_per_week, focus, agent_id } = bodyResult.data
    if (!client_id || !weeks || !posts_per_week) {
      return NextResponse.json({ error: 'client_id, weeks, posts_per_week required' }, { status: 400 })
    }

    const budgetCheck = await checkUserBudget(supabase, authResult.auth.user.id)
    if (!budgetCheck.ok && budgetCheck.response) return budgetCheck.response

    const [
      { data: client },
      { data: knowledge },
      { data: keywords },
      { data: history },
      { data: existingPlan },
      { data: compSites },
    ] = await Promise.all([
      supabase.from('client_profiles').select('*').eq('id', client_id).single(),
      supabase.from('client_knowledge').select('*').eq('client_id', client_id).maybeSingle(),
      supabase.from('keyword_banks').select('keyword,intent,funnel_stage,monthly_volume,difficulty,current_position,content_targeting_this,priority,opportunity_score').eq('client_id', client_id).order('opportunity_score', { ascending: false, nullsFirst: false }).limit(100),
      supabase.from('content_history').select('title,primary_keyword,url,published_at').eq('client_id', client_id).order('published_at', { ascending: false }).limit(40),
      supabase.from('content_calendar').select('title,primary_keyword,status,scheduled_date').eq('client_id', client_id).not('status', 'in', '("cancelled","published")'),
      supabase.from('competitor_sites').select('id,name,url').eq('client_id', client_id),
    ])

    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    if (!(await userCanAccessClient(supabase, authResult.auth.user.id, client_id))) return forbiddenResponse()

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured in Vercel environment variables.' }, { status: 500 })
    }

    // Load top competitor pages with summaries
    let competitorContext = ''
    if (compSites && compSites.length > 0) {
      const compPageResults = await Promise.all(
        compSites.map((site: any) =>
          supabase.from('competitor_pages')
            .select('url,title,content_summary,word_count')
            .eq('competitor_id', site.id)
            .not('content_summary', 'is', null)
            .order('word_count', { ascending: false })
            .limit(15)
        )
      )
      const compLines = compSites.map((site: any, i: number) => {
        const pages = compPageResults[i].data || []
        if (pages.length === 0) return `${site.name || site.url}: not yet crawled`
        return `${site.name || site.url}:\n${pages.map((p: any) => `  "${p.title || p.url}" — ${p.content_summary || ''}`).join('\n')}`
      })
      competitorContext = compLines.join('\n\n')
    }

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

${competitorContext ? `COMPETITOR CONTENT (what they cover that you might not):\n${competitorContext}` : 'No competitor data — add and crawl competitors in the client Competitors tab.'}

KEYWORD BANK (targeting:NOTHING means genuinely untargeted):
${kwLines || 'Empty'}

PUBLISHED CONTENT HISTORY:
${historyLines || 'None'}

ALREADY PLANNED (do not duplicate):
${existingLines || 'None'}

TASK:
Create a ${weeks}-week content plan of exactly ${totalPieces} pieces (${posts_per_week} per week), starting ${today.toISOString().split('T')[0]}.
${focus ? `Focus area: ${focus}` : ''}

You are an elite SEO strategist finding opportunities a human would miss. Before sequencing, identify:

1. NEAR-MISS WINS: Keywords already ranking position 3-15 with no dedicated page -- these are the fastest ranking improvements possible. A page built for the keyword it's already ranking for will almost always jump to page 1.

2. FEATURED SNIPPET GAPS: Informational keywords with high impressions where the current page doesn't have a direct answer block in the first 100 words. A concise answer block added to (or a new page targeting) these queries can claim position 0.

3. COMPETITOR GAPS: Topics your competitors cover that the client doesn't. Look at the site pages -- what clusters are missing entirely?

4. CANNIBALISATION RISKS: Multiple pages targeting the same or very similar keywords. Do not plan more content for cannibalised clusters -- flag them instead in the rationale field.

5. CONTENT DECAY CANDIDATES: Keywords where a page exists but is likely thin or outdated (word_count < 600, no recent update). These are refresh opportunities, not new pages.

6. TOPICAL AUTHORITY GAPS: Are there entire topic areas the site hasn't touched that are directly relevant to the business?

Sequencing rules:
1. Near-miss keywords with no dedicated page come first -- fastest ROI
2. High-volume untargeted keywords with KD under 40 come second
3. Featured snippet opportunities third
4. Authority-building pillars and hub pages before supporting posts
5. Commercial intent before informational at equal difficulty
6. Never plan content that duplicates a live page URL or already-planned item
7. Vary content types -- not every piece should be a blog_post. Location pages, pillar pages, FAQ pages, and comparison pages all have different ranking dynamics.
8. Never plan 3+ pieces targeting the same location in a row -- spread geography across the plan
9. Spread publish dates evenly: ${posts_per_week} per week, weekdays only (Mon-Fri)
10. If the keyword bank lacks enough high-value untargeted keywords, say so in the summary rather than padding with low-value variations

Each entry's rationale must explain WHY this specific piece in this specific position -- not just "good keyword". Reference the actual data: position, impressions, competitor coverage, or topical gap that makes it the right move.

Respond with ONLY a JSON object, no markdown fences, no preamble:
{
  "summary": "3-4 sentences explaining your strategy: what opportunities you found, what you prioritised and why, and what gaps remain after this plan",
  "intelligence_notes": "Any cannibalisation risks, decay candidates, or structural issues found that are NOT in the plan but need attention",
  "entries": [
    {
      "title": "Working title",
      "primary_keyword": "target keyword",
      "content_type": "blog_post | pillar_page | category_page | local_seo | faq_page | comparison_page",
      "scheduled_date": "YYYY-MM-DD",
      "priority": 1,
      "rationale": "Why this piece, why now, what specific data point justifies it",
      "notes": "Angle, approach, or structural note in one sentence"
    }
  ]
}`

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 6000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!aiRes.ok) {
      const errText = await aiRes.text()
      return NextResponse.json({ error: `AI call failed: ${errText.slice(0, 200)}` }, { status: 500 })
    }

    const aiData = await aiRes.json()
    if (aiData.usage) {
      const tokensUsed = (aiData.usage.input_tokens || 0) + (aiData.usage.output_tokens || 0)
      await recordTokenUsage({
        supabase,
        userId: authResult.auth.user.id,
        workspaceId: (client as any).workspace_id || null,
        clientId: client_id,
        agentId: agent_id || null,
        action: 'calendar_plan',
        tokensUsed,
        detail: { input_tokens: aiData.usage.input_tokens, output_tokens: aiData.usage.output_tokens, model: 'claude-sonnet-4-6' },
      })
    }
    const raw = (aiData.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()

    let parsed: { summary: string; intelligence_notes?: string; entries: any[] }
    try {
      const clean = raw.replace(/```json|```/g, '').trim()
      parsed = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'AI returned invalid JSON', raw: raw.slice(0, 500) }, { status: 500 })
    }

    if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
      return NextResponse.json({ error: 'No entries in plan' }, { status: 500 })
    }

    const VALID_TYPES = ['blog_post', 'pillar_page', 'category_page', 'local_seo', 'faq_page', 'comparison_page']
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
      intelligence_notes: parsed.intelligence_notes || '',
      created: created?.length || 0,
      entries: created,
      usage_warning: budgetCheck.warning,
    })
  } catch (err: any) {
    console.error('[calendar/generate-plan] error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
