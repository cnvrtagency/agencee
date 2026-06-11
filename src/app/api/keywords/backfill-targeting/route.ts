import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forbiddenResponse, requireUser, userCanAccessClient } from '@/lib/server/auth'
import { checkUserBudget, recordTokenUsage } from '@/lib/server/token-usage'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const { client_id } = await req.json()
  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 })
  if (!(await userCanAccessClient(supabase, authResult.auth.user.id, client_id))) return forbiddenResponse()

  const { data: client } = await supabase
    .from('client_profiles')
    .select('workspace_id,user_id')
    .eq('id', client_id)
    .maybeSingle()
  const ownerUserId = client?.user_id || authResult.auth.user.id
  const budgetCheck = await checkUserBudget(supabase, ownerUserId)
  if (!budgetCheck.ok && budgetCheck.response) return budgetCheck.response

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured in Vercel environment variables.' }, { status: 500 })

  const [{ data: keywords }, { data: knowledge }] = await Promise.all([
    supabase.from('keyword_banks').select('id,keyword').eq('client_id', client_id).is('content_targeting_this', null),
    supabase.from('client_knowledge').select('site_pages').eq('client_id', client_id).maybeSingle(),
  ])

  if (!keywords?.length) return NextResponse.json({ matched: 0, message: 'No untargeted keywords' })
  if (!knowledge?.site_pages?.length) return NextResponse.json({ error: 'No site pages in knowledge panel -- run a crawl first' }, { status: 400 })

  const pages = (knowledge.site_pages as any[]).map((p: any) =>
    `${p.url} | "${p.title || ''}"${p.h1 ? ` | H1: "${p.h1}"` : ''}`
  )

  const prompt = `You are an SEO analyst. Match keywords to live pages that genuinely target them.

A page "targets" a keyword if it is clearly the page someone searching that keyword should land on -- the keyword (or a close variant) is the page's primary topic, reflected in its URL, title, or H1. A passing mention does not count. Be strict: only match when the page is genuinely built for that keyword.

KEYWORDS:
${keywords.map((k: any) => k.keyword).join('\n')}

LIVE PAGES:
${pages.join('\n')}

Respond with ONLY a JSON object mapping keyword to URL for genuine matches. Omit keywords with no genuine match. No markdown fences, no commentary:
{"keyword here": "https://...", ...}`

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!aiRes.ok) return NextResponse.json({ error: 'AI call failed' }, { status: 500 })
  const aiData = await aiRes.json()
  if (aiData.usage) {
    const tokensUsed = (aiData.usage.input_tokens || 0) + (aiData.usage.output_tokens || 0)
    await recordTokenUsage({
      supabase,
      userId: ownerUserId,
      workspaceId: client?.workspace_id || null,
      clientId: client_id,
      agentId: null,
      action: 'backfill_targeting',
      tokensUsed,
      detail: { input_tokens: aiData.usage.input_tokens, output_tokens: aiData.usage.output_tokens, model: 'claude-haiku-4-5-20251001' },
    })
  }
  const raw = (aiData.content?.[0]?.text || '').replace(/```json|```/g, '').trim()

  let mapping: Record<string, string>
  try { mapping = JSON.parse(raw) } catch {
    return NextResponse.json({ error: 'Invalid JSON from AI', raw: raw.slice(0, 300) }, { status: 500 })
  }

  const validUrls = new Set((knowledge.site_pages as any[]).map((p: any) => p.url))
  let matched = 0
  const results: Record<string, string> = {}

  for (const kw of keywords) {
    const url = mapping[(kw as any).keyword]
    if (url && validUrls.has(url)) {
      await supabase.from('keyword_banks').update({ content_targeting_this: url }).eq('id', (kw as any).id)
      results[(kw as any).keyword] = url
      matched++
    }
  }

  return NextResponse.json({ matched, total_untargeted: keywords.length, mapping: results })
}
