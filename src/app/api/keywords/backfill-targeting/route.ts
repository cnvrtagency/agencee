import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forbiddenResponse, requireUser, userCanAccessClient } from '@/lib/server/auth'
import { checkUserBudget, recordTokenUsage } from '@/lib/server/token-usage'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

export const maxDuration = 60

function normaliseForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\baudiology\b/g, 'audiolog')
    .replace(/\baudiologist\b/g, 'audiolog')
    .replace(/\bhearing aids\b/g, 'hearing aid')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function keywordTerms(keyword: string): string[] {
  const stop = new Set(['the', 'and', 'for', 'with', 'near', 'me', 'at', 'to', 'in', 'a', 'an'])
  return normaliseForMatch(keyword).split(/\s+/).filter(w => w.length > 1 && !stop.has(w))
}

function pageCoversKeyword(page: any, keyword: string): boolean {
  const haystack = normaliseForMatch([page.url, page.title, page.h1, page.meta_description, page.content_summary].filter(Boolean).join(' '))
  const phrase = normaliseForMatch(keyword)
  if (phrase && haystack.includes(phrase)) return true
  const terms = keywordTerms(keyword)
  return terms.length > 0 && terms.every(term => haystack.includes(term))
}

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

  const [{ data: keywords }, { data: knowledge }, { data: crawledPages }] = await Promise.all([
    supabase.from('keyword_banks').select('id,keyword').eq('client_id', client_id).is('content_targeting_this', null),
    supabase.from('client_knowledge').select('site_pages').eq('client_id', client_id).maybeSingle(),
    supabase.from('site_pages').select('url,title,h1,meta_description,content_summary').eq('client_id', client_id).limit(100),
  ])

  if (!keywords?.length) return NextResponse.json({ matched: 0, message: 'No untargeted keywords' })
  const pageRows = crawledPages?.length ? crawledPages : (knowledge?.site_pages || [])
  if (!pageRows?.length) return NextResponse.json({ error: 'No site pages found -- run a crawl first' }, { status: 400 })

  let deterministicMatched = 0
  const deterministicResults: Record<string, string> = {}
  const remainingKeywords: any[] = []
  for (const kw of keywords) {
    const page = pageRows.find((p: any) => pageCoversKeyword(p, (kw as any).keyword))
    if (page?.url) {
      await supabase.from('keyword_banks').update({ content_targeting_this: page.url }).eq('id', (kw as any).id)
      deterministicResults[(kw as any).keyword] = page.url
      deterministicMatched++
    } else {
      remainingKeywords.push(kw)
    }
  }

  if (remainingKeywords.length === 0) {
    return NextResponse.json({ matched: deterministicMatched, total_untargeted: keywords.length, mapping: deterministicResults })
  }

  const pages = (pageRows as any[]).map((p: any) =>
    `${p.url} | "${p.title || ''}"${p.h1 ? ` | H1: "${p.h1}"` : ''}${p.content_summary ? ` | Summary: "${p.content_summary}"` : ''}`
  )

  const prompt = `You are an SEO analyst. Match keywords to live pages that genuinely target them.

A page "targets" a keyword if it is clearly the page someone searching that keyword should land on -- the keyword (or a close variant) is the page's primary topic, reflected in its URL, title, or H1. A passing mention does not count. Be strict: only match when the page is genuinely built for that keyword.

KEYWORDS:
${remainingKeywords.map((k: any) => k.keyword).join('\n')}

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

  const validUrls = new Set((pageRows as any[]).map((p: any) => p.url))
  let matched = deterministicMatched
  const results: Record<string, string> = { ...deterministicResults }

  for (const kw of remainingKeywords) {
    const url = mapping[(kw as any).keyword]
    if (url && validUrls.has(url)) {
      await supabase.from('keyword_banks').update({ content_targeting_this: url }).eq('id', (kw as any).id)
      results[(kw as any).keyword] = url
      matched++
    }
  }

  return NextResponse.json({ matched, total_untargeted: keywords.length, mapping: results })
}
