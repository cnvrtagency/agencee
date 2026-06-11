export const maxDuration = 300 // 5 min — needed for long blog + image generation chains

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { safeDecrypt } from '@/lib/crypto'

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const supabase = await getSupabase()
  const { client_id, agent_id } = body

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()

  // Load workspace settings (API key + budget)
  let anthropicKey = process.env.ANTHROPIC_API_KEY!
  let userId: string | null = null
  let workspaceId: string | null = null

  if (user) {
    userId = user.id
    const { data: wsRow } = await supabase.from('workspaces').select('id').eq('owner_id', user.id).maybeSingle()
    if (wsRow) workspaceId = wsRow.id
    const { data: ws } = await supabase
      .from('workspace_settings')
      .select('anthropic_api_key,monthly_token_budget,tokens_used_this_month,budget_reset_at')
      .eq('user_id', user.id)
      .maybeSingle()

    if (ws) {
      if (ws.anthropic_api_key) {
        const decrypted = safeDecrypt(ws.anthropic_api_key)
        anthropicKey = decrypted || ws.anthropic_api_key
      }

      // Check if budget reset is needed
      if (ws.budget_reset_at && new Date(ws.budget_reset_at) <= new Date()) {
        await supabase.from('workspace_settings').update({
          tokens_used_this_month: 0,
          budget_reset_at: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
        }).eq('user_id', user.id)
      } else {
        // Enforce budget
        if (ws.tokens_used_this_month >= ws.monthly_token_budget) {
          return NextResponse.json({
            error: 'Monthly token budget reached. Increase your limit in Settings to continue.',
            budget_exceeded: true,
          }, { status: 402 })
        }
      }
    }
  }

  // Wrap system prompt with cache_control
  let system = body.system
  if (typeof system === 'string' && system.length > 0) {
    system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
  }

  const betaHeaders = ['prompt-caching-2024-07-31']
  if (body.thinking) betaHeaders.push('interleaved-thinking-2025-05-14')
  const hasWebSearch = (body.tools || []).some((t: any) => t.type === 'web_search_20250305')
  if (hasWebSearch) betaHeaders.push('web-search-2025-03-05')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': betaHeaders.join(','),
    },
    body: JSON.stringify({ ...body, system }),
  })

  const data = await response.json()

  // Track token usage
  if (userId && data.usage) {
    const tokensUsed = (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
    if (tokensUsed > 0) {
      const { error: rpcErr } = await supabase.rpc('increment_tokens', { p_user_id: userId, p_tokens: tokensUsed })
      if (rpcErr) console.error('increment_tokens RPC error:', rpcErr.message, { userId, tokensUsed })
      // Log to agent_activity for per-client token tracking
      await supabase.from('agent_activity').insert({
        workspace_id: workspaceId || null,
        user_id: userId,
        client_id: client_id || null,
        agent_id: agent_id || null,
        action: 'chat',
        tokens_used: tokensUsed,
      }).then(({ error }) => { if (error) console.error('agent_activity insert error:', error.message) })
    }
  }

  return NextResponse.json(data)
}
