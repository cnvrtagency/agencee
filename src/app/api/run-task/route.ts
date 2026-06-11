import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cleanContent } from '@/lib/content-clean'
import { safeDecrypt } from '@/lib/crypto'
import { forbiddenResponse, requireUserOrInternal, userCanAccessClient } from '@/lib/server/auth'
import { checkRateLimit, getRateLimitIdentity } from '@/lib/server/rate-limit'
import { readJsonWithLimit } from '@/lib/server/request-body'
import { checkUserBudget, recordTokenUsage } from '@/lib/server/token-usage'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const authResult = await requireUserOrInternal(req)
  if (!authResult.ok) return authResult.response

  const rate = checkRateLimit({
    key: `run-task:${getRateLimitIdentity(req, authResult.auth.user?.id)}`,
    limit: 30,
    windowMs: 10 * 60 * 1000,
  })
  if (!rate.ok) return rate.response

  let queue_item_id: string | null = null
  try {
    const bodyResult = await readJsonWithLimit<any>(req, 8_000)
    if (!bodyResult.ok) return bodyResult.response
    const body = bodyResult.data
    queue_item_id = body.queue_item_id
    if (!queue_item_id) return NextResponse.json({ error: 'queue_item_id required' }, { status: 400 })

    // Load queue item + client
    const { data: item, error: itemError } = await supabase
      .from('content_queue')
      .select('*, client_profiles(*)')
      .eq('id', queue_item_id)
      .single()

    if (itemError || !item) return NextResponse.json({ error: 'Queue item not found' }, { status: 404 })
    const client = item.client_profiles as any

    if (authResult.auth.user && !(await userCanAccessClient(supabase, authResult.auth.user.id, item.client_id))) {
      return forbiddenResponse()
    }

    if (item.status === 'running') {
      const startedAt = item.started_at
        ? new Date(item.started_at).getTime()
        : item.created_at
          ? new Date(item.created_at).getTime()
          : 0
      const stale = startedAt > 0 && startedAt < Date.now() - 10 * 60 * 1000
      if (!stale) return NextResponse.json({ error: 'Task already running' }, { status: 409 })
      await supabase.from('content_queue').update({ status: 'failed' }).eq('id', queue_item_id)
    }
    if (item.status === 'done' || item.status === 'review') {
      return NextResponse.json({ error: 'Task already completed' }, { status: 409 })
    }

    const ownerUserId = client?.user_id || authResult.auth.user?.id || null
    const budgetCheck = ownerUserId ? await checkUserBudget(supabase, ownerUserId) : { ok: true, warning: null }
    if (!budgetCheck.ok && budgetCheck.response) {
      await supabase.from('content_queue').update({ status: 'failed' }).eq('id', queue_item_id)
      return budgetCheck.response
    }

    // Get Anthropic API key from the owning workspace settings (fallback to env)
    let apiKey = process.env.ANTHROPIC_API_KEY
    const { data: wsSettings } = ownerUserId
      ? await supabase.from('workspace_settings').select('anthropic_api_key').eq('user_id', ownerUserId).maybeSingle()
      : await supabase.from('workspace_settings').select('anthropic_api_key').eq('workspace_id', client?.workspace_id).maybeSingle()
    if (wsSettings?.anthropic_api_key) {
      apiKey = safeDecrypt(wsSettings.anthropic_api_key) || wsSettings.anthropic_api_key
    }
    if (!apiKey) {
      await supabase.from('content_queue').update({ status: 'failed' }).eq('id', queue_item_id)
      return NextResponse.json({ error: 'No Anthropic API key configured' }, { status: 500 })
    }

    // Mark as running only after auth, budget and API key checks pass.
    await supabase.from('content_queue').update({ status: 'running' }).eq('id', queue_item_id)

    // Load context in parallel: knowledge panel, content history, site pages, keyword bank
    const [{ data: knowledge }, { data: history }, { data: sitePages }, { data: keywords }] = await Promise.all([
      supabase.from('client_knowledge').select('site_pages,gsc_snapshot,content_summary,agent_notes').eq('client_id', item.client_id).maybeSingle(),
      supabase.from('content_history').select('title,primary_keyword,url,summary').eq('client_id', item.client_id).order('published_at', { ascending: false }).limit(40),
      supabase.from('site_pages').select('url,title,h1,meta_description,word_count').eq('client_id', item.client_id).order('url').limit(60),
      supabase.from('keyword_banks').select('keyword,intent,funnel_stage,monthly_volume,difficulty,current_position,content_targeting_this,opportunity_score').eq('client_id', item.client_id).order('opportunity_score', { ascending: false, nullsFirst: false }).limit(100),
    ])

    const sitePagesList = (sitePages || []).map((p: any) =>
      `${p.url} | "${p.title || ''}"${p.h1 ? ` | H1: "${p.h1}"` : ''}${p.meta_description ? '' : ' [NO META]'}${p.word_count ? ` | ${p.word_count}w` : ''}`
    ).join('\n')

    const historyList = (history || []).map((h: any) =>
      `"${h.title}" [${h.primary_keyword || 'no keyword'}]${h.url ? ` -> ${h.url}` : ''} | ${h.summary || ''}`
    ).join('\n')

    const keywordList = (keywords || []).map((k: any) =>
      `"${k.keyword}" | ${k.intent || '-'} | vol: ${k.monthly_volume || '?'} | KD: ${k.difficulty || '?'} | pos: ${k.current_position || 'not ranking'} | targeting: ${k.content_targeting_this || 'nothing yet'}`
    ).join('\n')

    const gscSnapshot = knowledge?.gsc_snapshot as any
    const gscLines = gscSnapshot ? [
      `Total clicks (28d): ${gscSnapshot.total_clicks ?? '-'}`,
      `Total impressions (28d): ${gscSnapshot.total_impressions ?? '-'}`,
      `Average position: ${gscSnapshot.avg_position ?? '-'}`,
      gscSnapshot.near_misses?.length ? `Near-miss keywords: ${(gscSnapshot.near_misses as any[]).slice(0, 5).map((m: any) => `"${m.query}" pos ${m.position}`).join(', ')}` : '',
    ].filter(Boolean).join('\n') : null

    const systemPrompt = [
      `You are Ada, an expert SEO content writer working for ${client?.name || 'the client'}.`,
      '',
      'WORKING PRINCIPLES:',
      '- Write for humans first, search engines second',
      '- Every claim must be accurate and useful to the reader',
      '- Match the brand voice consistently throughout',
      '- Integrate keywords naturally -- never stuff',
      '',
      client?.brand_voice ? `BRAND VOICE:\n${client.brand_voice}` : '',
      client?.icp ? `TARGET READER:\n${client.icp}` : '',
      client?.usp ? `USP / DIFFERENTIATORS:\n${client.usp}` : '',
      client?.trust_signals ? `TRUST SIGNALS:\n${client.trust_signals}` : '',
      client?.cta_approach ? `CTA APPROACH:\n${client.cta_approach}` : '',
      '',
      knowledge?.content_summary ? `SITE CONTENT SUMMARY:\n${knowledge.content_summary}` : '',
      gscLines ? `GSC PERFORMANCE (28d):\n${gscLines}` : '',
      '',
      sitePagesList ? `LIVE SITE PAGES (for internal links):\n${sitePagesList}` : '',
      '',
      historyList ? `CONTENT HISTORY (do not repeat these angles):\n${historyList}` : '',
      '',
      keywordList ? `KEYWORD BANK:\n${keywordList}` : '',
    ].filter(s => s !== undefined && s !== null && s !== '').join('\n').trim()

    const supporting = Array.isArray(item.supporting_keywords) && item.supporting_keywords.length
      ? `Supporting keywords: ${item.supporting_keywords.join(', ')}`
      : ''
    const internalLinks = item.internal_links
      ? `\nInternal link targets to use:\n${item.internal_links}`
      : ''
    const brief = item.title_brief ? `\nEditorial brief: ${item.title_brief}` : ''

    const userPrompt = [
      `Write a comprehensive SEO blog post for ${client?.name || 'the client'}.`,
      '',
      `Primary keyword: ${item.primary_keyword}`,
      supporting,
      `Content type: ${item.content_type || 'blog_post'}`,
      `Target word count: ${item.word_count || 1200} words`,
      brief,
      internalLinks,
      '',
      'Requirements:',
      '- Start with YAML frontmatter (title, description, keyword, date)',
      '- Title tag (~60 chars, lead with primary keyword)',
      '- Meta description (~155 chars, keyword + value prop)',
      '- Primary keyword in H1, first 100 words, at least one H2, title tag, meta description',
      '- Proper heading hierarchy (H2/H3)',
      '- FAQ section targeting related long-tail questions',
      '- Clear CTA in the conclusion',
      '- Suggest 2-3 image placements with SEO filename + descriptive alt text',
      '- Add 2-3 internal links using real URLs from the live site pages list above',
      '- Do not repeat topics or angles already covered in the content history',
      '',
      'Return the complete article as markdown, starting with --- frontmatter --- then the body.',
    ].filter(Boolean).join('\n')

    // Call Anthropic API directly
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 12000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    const anthropicData = await anthropicRes.json()
    if (!anthropicRes.ok) {
      await supabase.from('content_queue').update({ status: 'failed' }).eq('id', queue_item_id)
      return NextResponse.json({ error: anthropicData.error?.message || 'Anthropic API error' }, { status: 500 })
    }

    // Track token usage against workspace budget
    const usage = anthropicData.usage
    if (usage) {
      const tokensUsed = (usage.input_tokens || 0) + (usage.output_tokens || 0)
      await recordTokenUsage({
        supabase,
        userId: ownerUserId,
        workspaceId: client?.workspace_id || null,
        clientId: item.client_id,
        action: 'queue_task_api_call',
        tokensUsed,
        detail: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, model: 'claude-sonnet-4-6', source: 'run-task' },
      })
      await supabase.from('content_queue').update({ tokens_used: tokensUsed }).eq('id', queue_item_id)
    }

    const content = (anthropicData.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')

    if (!content.trim()) {
      await supabase.from('content_queue').update({ status: 'failed' }).eq('id', queue_item_id)
      return NextResponse.json({ error: 'Model returned empty content' }, { status: 500 })
    }

    // Extract title from frontmatter or first # heading
    const fmTitleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m)
    const h1Match = content.match(/^#\s+(.+)$/m)
    const title = fmTitleMatch?.[1]?.trim() || h1Match?.[1]?.trim() || item.primary_keyword

    // Save to content_outputs
    const { data: outputRow, error: outputError } = await supabase
      .from('content_outputs')
      .insert({
        client_id: item.client_id,
        user_id: item.user_id,
        queue_item_id: item.id,
        agent_type: item.agent_type || 'seo',
        title,
        content: cleanContent(content),
        primary_keyword: item.primary_keyword,
        word_count: item.word_count,
        approved: false,
        notes: `Generated by queue worker. Queue item: ${item.id}`,
      })
      .select()
      .single()

    if (outputError) {
      await supabase.from('content_queue').update({ status: 'failed' }).eq('id', queue_item_id)
      return NextResponse.json({ error: `Failed to save output: ${outputError.message}` }, { status: 500 })
    }

    // Mark queue item as review
    await supabase.from('content_queue').update({
      status: 'review',
    }).eq('id', queue_item_id)

    return NextResponse.json({ success: true, output_id: outputRow.id, title })
  } catch (err: any) {
    console.error('[run-task] error:', err.message)
    if (queue_item_id) {
      try { await supabase.from('content_queue').update({ status: 'failed' }).eq('id', queue_item_id) } catch {}
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
