import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cleanContent } from '@/lib/content-clean'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const maxDuration = 300

export async function POST(req: NextRequest) {
  let queue_item_id: string | null = null
  try {
    const body = await req.json()
    queue_item_id = body.queue_item_id
    if (!queue_item_id) return NextResponse.json({ error: 'queue_item_id required' }, { status: 400 })

    // Load queue item + client
    const { data: item, error: itemError } = await supabase
      .from('content_queue')
      .select('*, client_profiles(*)')
      .eq('id', queue_item_id)
      .single()

    if (itemError || !item) return NextResponse.json({ error: 'Queue item not found' }, { status: 404 })
    if (item.status === 'running') return NextResponse.json({ error: 'Task already running' }, { status: 409 })
    if (item.status === 'done' || item.status === 'review') {
      return NextResponse.json({ error: 'Task already completed' }, { status: 409 })
    }

    // Mark as running
    await supabase.from('content_queue').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', queue_item_id)

    // Get Anthropic API key from workspace_settings (fallback to env)
    const { data: wsSettings } = await supabase.from('workspace_settings').select('anthropic_api_key').limit(1).maybeSingle()
    const apiKey = wsSettings?.anthropic_api_key || process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      await supabase.from('content_queue').update({ status: 'failed' }).eq('id', queue_item_id)
      return NextResponse.json({ error: 'No Anthropic API key configured' }, { status: 500 })
    }

    const client = item.client_profiles as any

    // Build content generation prompt
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
      client?.brand_voice ? `Brand voice: ${client.brand_voice}` : '',
      client?.icp ? `Target reader: ${client.icp}` : '',
      '',
      'Requirements:',
      '- Start with YAML frontmatter (title, description, keyword, date)',
      '- Title tag (~60 chars, lead with primary keyword)',
      '- Meta description (~155 chars, keyword + value prop)',
      '- Primary keyword in H1, first 100 words, at least one H2, title tag, meta description',
      '- Proper heading hierarchy (H2/H3)',
      '- FAQ section targeting related long-tail questions',
      '- Clear CTA in the conclusion',
      '- Suggest 2–3 image placements with SEO filename + descriptive alt text',
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
        max_tokens: 8000,
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
    if (usage && client?.workspace_id) {
      const tokensUsed = (usage.input_tokens || 0) + (usage.output_tokens || 0)
      supabase.from('agent_activity').insert({
        workspace_id: client.workspace_id,
        client_id: item.client_id,
        action: 'queue_task_api_call',
        tokens_used: tokensUsed,
        detail: JSON.stringify({ input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, model: 'claude-sonnet-4-6', source: 'run-task' }),
      }).then(({ error }) => { if (error) console.error('[run-task] token tracking failed:', error.message) })
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
      completed_at: new Date().toISOString(),
    }).eq('id', queue_item_id)

    return NextResponse.json({ success: true, output_id: outputRow.id, title })
  } catch (err: any) {
    console.error('run-task error:', err.message)
    if (queue_item_id) {
      try { await supabase.from('content_queue').update({ status: 'failed' }).eq('id', queue_item_id) } catch {}
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
