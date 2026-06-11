import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forbiddenResponse, requireUserOrInternal, userCanAccessClient } from '@/lib/server/auth'
import { checkUserBudget, recordTokenUsage } from '@/lib/server/token-usage'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const authResult = await requireUserOrInternal(req)
  if (!authResult.ok) return authResult.response

  const { client_id, period_start, period_end } = await req.json().catch(() => ({}))
  if (!client_id || !period_start || !period_end) {
    return NextResponse.json({ error: 'client_id, period_start, period_end required' }, { status: 400 })
  }
  if (authResult.auth.user && !(await userCanAccessClient(supabase, authResult.auth.user.id, client_id))) {
    return forbiddenResponse()
  }

  // Load all data in parallel
  const [
    { data: clientProfile },
    { data: outputs },
    { data: searchPerf },
    { count: keywordCount },
    { count: activityCount },
    { data: contentHistory },
  ] = await Promise.all([
    supabase.from('client_profiles').select('*').eq('id', client_id).single(),
    supabase.from('content_outputs').select('*').eq('client_id', client_id).eq('approved', true).gte('created_at', period_start).lte('created_at', period_end + 'T23:59:59Z'),
    supabase.from('search_performance').select('query, page, position, impressions, clicks, ctr').eq('client_id', client_id).order('impressions', { ascending: false }).limit(50),
    supabase.from('keyword_banks').select('id', { count: 'exact', head: true }).eq('client_id', client_id),
    supabase.from('agent_activity').select('id', { count: 'exact', head: true }).eq('client_id', client_id).gte('created_at', period_start).lte('created_at', period_end + 'T23:59:59Z'),
    supabase.from('content_history').select('*').eq('client_id', client_id).gte('published_at', period_start).lte('published_at', period_end + 'T23:59:59Z').order('published_at', { ascending: false }),
  ])

  if (!clientProfile) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const ownerUserId = clientProfile.user_id || authResult.auth.user?.id || null
  if (ownerUserId) {
    const budgetCheck = await checkUserBudget(supabase, ownerUserId)
    if (!budgetCheck.ok && budgetCheck.response) return budgetCheck.response
  }

  // Compute search performance averages
  const gscRows = searchPerf || []
  const avgPosition = gscRows.length > 0 ? gscRows.reduce((a, r) => a + r.position, 0) / gscRows.length : null
  const totalClicks = gscRows.reduce((a, r) => a + r.clicks, 0)
  const totalImpressions = gscRows.reduce((a, r) => a + r.impressions, 0)
  const nearMiss = gscRows.filter(r => r.position >= 5 && r.position <= 15 && r.impressions > 50).sort((a, b) => b.impressions - a.impressions)

  // Count keywords with content
  const { count: kwWithContent } = await supabase
    .from('keyword_banks')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client_id)
    .not('content_targeting_this', 'is', null)

  // Generate executive summary via Anthropic
  let executiveSummary = ''
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey && clientProfile) {
    try {
      const summaryPrompt = `Write a 3-sentence executive summary for an SEO content report.
Client: ${clientProfile.name}
Period: ${period_start} to ${period_end}
Content published: ${(outputs || []).length} pieces
Top keywords: ${gscRows.slice(0, 5).map(r => `"${r.query}" (#${r.position.toFixed(0)})`).join(', ') || 'no data'}
Total clicks: ${totalClicks.toLocaleString()}
Total impressions: ${totalImpressions.toLocaleString()}
Near-miss opportunities: ${nearMiss.length}
Agent activities: ${activityCount || 0}
Write professionally. Focus on results and opportunities.`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          messages: [{ role: 'user', content: summaryPrompt }],
        }),
      })
      const aiData = await res.json()
      executiveSummary = aiData.content?.[0]?.text || ''
      if (aiData.usage) {
        const tokensUsed = (aiData.usage.input_tokens || 0) + (aiData.usage.output_tokens || 0)
        await recordTokenUsage({
          supabase,
          userId: ownerUserId,
          workspaceId: clientProfile.workspace_id || null,
          clientId: client_id,
          agentId: null,
          action: 'report_summary',
          tokensUsed,
          detail: { input_tokens: aiData.usage.input_tokens, output_tokens: aiData.usage.output_tokens, model: 'claude-sonnet-4-6' },
        })
      }
    } catch {
      executiveSummary = `During ${period_start} to ${period_end}, ${clientProfile.name} published ${(outputs || []).length} pieces of content. ${gscRows.length > 0 ? `Search performance data shows ${totalClicks.toLocaleString()} clicks and ${totalImpressions.toLocaleString()} impressions.` : ''} ${nearMiss.length > 0 ? `${nearMiss.length} near-miss keyword opportunities identified.` : ''}`
    }
  }

  const reportData = {
    client: clientProfile,
    outputs: outputs || [],
    search_performance: {
      avg_position: avgPosition,
      total_clicks: totalClicks,
      total_impressions: totalImpressions,
      top_queries: gscRows.slice(0, 20),
      near_miss: nearMiss,
    },
    keywords: {
      total: keywordCount || 0,
      with_content: kwWithContent || 0,
    },
    agent_activity_count: activityCount || 0,
    content_history: contentHistory || [],
    executive_summary: executiveSummary,
  }

  const { data: report, error } = await supabase
    .from('reports')
    .insert({
      client_id,
      workspace_id: clientProfile?.workspace_id || null,
      period_start,
      period_end,
      status: 'ready',
      data: reportData,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ id: report.id })
}
