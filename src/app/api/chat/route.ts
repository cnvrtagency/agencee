export const maxDuration = 300 // 5 min, needed for long agent/tool chains.

import { NextRequest, NextResponse } from 'next/server'
import { safeDecrypt } from '@/lib/crypto'
import { getSupabaseAdmin, requireUser } from '@/lib/server/auth'
import { checkRateLimit, getRateLimitIdentity } from '@/lib/server/rate-limit'
import { checkUserBudget, recordTokenUsage, SESSION_TOKEN_LIMIT } from '@/lib/server/token-usage'

export async function POST(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const rate = checkRateLimit({
    key: `chat:${getRateLimitIdentity(req, authResult.auth.user.id)}`,
    limit: 120,
    windowMs: 10 * 60 * 1000,
  })
  if (!rate.ok) return rate.response

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { client_id, agent_id, session_tokens: sessionTokens, ...anthropicBody } = body
  const userId = authResult.auth.user.id

  if (Number(sessionTokens || 0) >= SESSION_TOKEN_LIMIT) {
    return NextResponse.json({
      error: 'This conversation has reached the 150k token safety limit. Start a new conversation to continue.',
      session_limit_exceeded: true,
    }, { status: 402 })
  }

  const budgetCheck = await checkUserBudget(supabase, userId)
  if (!budgetCheck.ok && budgetCheck.response) return budgetCheck.response

  let anthropicKey = process.env.ANTHROPIC_API_KEY
  let workspaceId: string | null = null

  const [{ data: wsRow }, { data: settings }] = await Promise.all([
    supabase.from('workspaces').select('id').eq('owner_id', userId).maybeSingle(),
    supabase.from('workspace_settings').select('anthropic_api_key').eq('user_id', userId).maybeSingle(),
  ])

  if (wsRow) workspaceId = wsRow.id
  if (settings?.anthropic_api_key) {
    const decrypted = safeDecrypt(settings.anthropic_api_key)
    anthropicKey = decrypted || settings.anthropic_api_key
  }

  if (!anthropicKey) {
    return NextResponse.json({
      error: 'ANTHROPIC_API_KEY is not configured. Add it in Settings or Vercel environment variables.',
    }, { status: 500 })
  }

  let system = anthropicBody.system
  if (typeof system === 'string' && system.length > 0) {
    system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
  }

  const betaHeaders = ['prompt-caching-2024-07-31']
  if (anthropicBody.thinking) betaHeaders.push('interleaved-thinking-2025-05-14')
  const hasWebSearch = (anthropicBody.tools || []).some((t: any) => t.type === 'web_search_20250305')
  if (hasWebSearch) betaHeaders.push('web-search-2025-03-05')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': betaHeaders.join(','),
    },
    body: JSON.stringify({ ...anthropicBody, system }),
  })

  const data = await response.json()
  if (!response.ok) return NextResponse.json(data, { status: response.status })

  if (data.usage) {
    const tokensUsed = (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
    await recordTokenUsage({
      supabase,
      userId,
      workspaceId,
      clientId: client_id || null,
      agentId: agent_id || null,
      action: 'chat',
      tokensUsed,
    })
  }

  if (budgetCheck.warning) data.usage_warning = budgetCheck.warning

  return NextResponse.json(data)
}
