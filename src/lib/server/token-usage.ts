import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

export const SESSION_TOKEN_LIMIT = 150_000

export type BudgetCheck = {
  ok: boolean
  warning: string | null
  response?: NextResponse
}

export async function checkUserBudget(
  supabase: SupabaseClient,
  userId: string,
): Promise<BudgetCheck> {
  const { data: ws } = await supabase
    .from('workspace_settings')
    .select('monthly_token_budget,tokens_used_this_month,budget_reset_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (!ws) return { ok: true, warning: null }

  let used = ws.tokens_used_this_month || 0
  const budget = ws.monthly_token_budget || 0

  if (ws.budget_reset_at && new Date(ws.budget_reset_at) <= new Date()) {
    used = 0
    await supabase.from('workspace_settings').update({
      tokens_used_this_month: 0,
      budget_reset_at: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
    }).eq('user_id', userId)
  }

  if (budget > 0 && used >= budget) {
    return {
      ok: false,
      warning: null,
      response: NextResponse.json({
        error: 'Monthly token budget reached. Increase your limit in Settings to continue.',
        budget_exceeded: true,
      }, { status: 402 }),
    }
  }

  const pct = budget > 0 ? used / budget : 0
  return {
    ok: true,
    warning: pct >= 0.8 ? `Monthly token usage is at ${Math.round(pct * 100)}% of budget.` : null,
  }
}

export async function recordTokenUsage(opts: {
  supabase: SupabaseClient
  userId?: string | null
  workspaceId?: string | null
  clientId?: string | null
  agentId?: string | null
  action: string
  tokensUsed: number
  detail?: unknown
}) {
  const { supabase, userId, workspaceId, clientId, agentId, action, tokensUsed, detail } = opts
  if (!tokensUsed || tokensUsed <= 0) return

  if (userId) {
    const { error } = await supabase.rpc('increment_tokens', { p_user_id: userId, p_tokens: tokensUsed })
    if (error) console.error('[token-usage] increment_tokens failed:', error.message)
  }

  const { error: logError } = await supabase.from('agent_activity').insert({
    workspace_id: workspaceId || null,
    user_id: userId || null,
    client_id: clientId || null,
    agent_id: agentId || null,
    action,
    tokens_used: tokensUsed,
    detail: detail === undefined ? null : typeof detail === 'string' ? detail : JSON.stringify(detail),
  })

  if (logError) console.error('[token-usage] agent_activity insert failed:', logError.message)
}
