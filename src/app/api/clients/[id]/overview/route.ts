import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forbiddenResponse, requireUserOrInternal, userCanAccessClient } from '@/lib/server/auth'
import { checkUserBudget, recordTokenUsage } from '@/lib/server/token-usage'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireUserOrInternal(req)
  if (!authResult.ok) return authResult.response

  const { id: clientId } = await params
  if (!clientId) return NextResponse.json({ error: 'Client ID required' }, { status: 400 })
  if (authResult.auth.user && !(await userCanAccessClient(supabase, authResult.auth.user.id, clientId))) return forbiddenResponse()

  // 1. Load client profile
  const { data: client, error: clientErr } = await supabase
    .from('client_profiles')
    .select('id, name, description, ai_overview, ai_overview_updated_at, workspace_id, user_id')
    .eq('id', clientId)
    .single()
  if (clientErr || !client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // 2. Return cached if fresh (< 24h)
  if (client.ai_overview && client.ai_overview_updated_at) {
    const age = Date.now() - new Date(client.ai_overview_updated_at).getTime()
    if (age < 24 * 60 * 60 * 1000) {
      return NextResponse.json({ overview: client.ai_overview, updated_at: client.ai_overview_updated_at, cached: true })
    }
  }

  // 3. Load supporting data
  const [
    { data: totalsAll },
    { count: contentCount },
    { data: latestContentArr },
    { count: keywordCount },
    { count: withContentCount },
  ] = await Promise.all([
    supabase.from('search_performance').select('*').eq('client_id', clientId).eq('query', '__total__'),
    supabase.from('content_history').select('*', { count: 'exact', head: true }).eq('client_id', clientId),
    supabase.from('content_history').select('title,published_at').eq('client_id', clientId).order('published_at', { ascending: false }).limit(1),
    supabase.from('keyword_banks').select('*', { count: 'exact', head: true }).eq('client_id', clientId),
    supabase.from('keyword_banks').select('*', { count: 'exact', head: true }).eq('client_id', clientId).not('content_targeting_this', 'is', null),
  ])

  const latestContent = latestContentArr?.[0] ?? null

  // Pick 28d totals — sort by period_start asc: [90d, 28d, 7d]
  const sortedTotals = (totalsAll || []).sort((a: any, b: any) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime())
  const totalRow28 = sortedTotals[1] ?? sortedTotals[0] ?? null

  const totalClicks = totalRow28?.clicks ?? 0
  const totalImpressions = totalRow28?.impressions ?? 0
  const avgPosition = totalRow28?.position ? (Math.round(totalRow28.position * 10) / 10) : null

  // Compute near-miss and low-ctr counts from 28d query rows
  const { data: rows28 } = await supabase
    .from('search_performance')
    .select('position,impressions,ctr')
    .eq('client_id', clientId)
    .not('query', 'in', '("__total__","__page__","__device__")')
    .order('impressions', { ascending: false })
    .limit(200)

  const nearMissCount = (rows28 || []).filter((r: any) => r.position >= 5 && r.position <= 15 && r.impressions > 50).length
  const lowCtrCount = (rows28 || []).filter((r: any) => r.position <= 10 && r.ctr < 0.03 && r.impressions > 100).length

  if (!totalRow28) {
    return NextResponse.json({ overview: null, updated_at: null, cached: false, no_gsc: true })
  }

  // 4. Call Claude Haiku to generate overview
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  const ownerUserId = client.user_id || authResult.auth.user?.id || null
  if (ownerUserId) {
    const budgetCheck = await checkUserBudget(supabase, ownerUserId)
    if (!budgetCheck.ok && budgetCheck.response) return budgetCheck.response
  }

  const prompt = `You are an SEO analyst. Based on the following data for ${client.name}, write a 3-4 sentence strategic summary. Be specific and actionable. UK English. No em dashes. No filler.

GSC Performance (last 28 days):
- Total clicks: ${totalClicks.toLocaleString()}
- Total impressions: ${totalImpressions.toLocaleString()}
- Average position: ${avgPosition ?? 'unknown'}
- Near-miss keywords (position 5-15): ${nearMissCount}
- Low CTR pages ranking on page 1: ${lowCtrCount}

Content:
- Total published pieces: ${contentCount ?? 0}
- Most recent: "${latestContent?.title ?? 'none'}" (${latestContent?.published_at ? new Date(latestContent.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'unknown'})
- Keywords in bank: ${keywordCount ?? 0} (${withContentCount ?? 0} have content targeting them)

Write a strategic summary covering: current SEO health, the single biggest opportunity right now, and what should happen next.`

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!aiRes.ok) {
    const aiErr = await aiRes.text()
    return NextResponse.json({ error: `AI generation failed: ${aiErr}` }, { status: 500 })
  }

  const aiData = await aiRes.json()
  if (aiData.usage) {
    const tokensUsed = (aiData.usage.input_tokens || 0) + (aiData.usage.output_tokens || 0)
    await recordTokenUsage({
      supabase,
      userId: ownerUserId,
      workspaceId: client.workspace_id || null,
      clientId,
      agentId: null,
      action: 'client_overview',
      tokensUsed,
      detail: { input_tokens: aiData.usage.input_tokens, output_tokens: aiData.usage.output_tokens, model: 'claude-haiku-4-5-20251001' },
    })
  }
  const overview = aiData.content?.[0]?.text?.trim() ?? null
  if (!overview) return NextResponse.json({ error: 'AI returned empty response' }, { status: 500 })

  const updatedAt = new Date().toISOString()
  await supabase.from('client_profiles').update({ ai_overview: overview, ai_overview_updated_at: updatedAt }).eq('id', clientId)

  return NextResponse.json({ overview, updated_at: updatedAt, cached: false })
}
