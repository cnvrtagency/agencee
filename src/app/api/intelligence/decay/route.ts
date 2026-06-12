import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forbiddenResponse, requireUserOrInternal, userCanAccessClient } from '@/lib/server/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const authResult = await requireUserOrInternal(req)
  if (!authResult.ok) return authResult.response

  const { client_id } = await req.json().catch(() => ({}))
  if (authResult.auth.user && !client_id) {
    return NextResponse.json({ error: 'client_id required' }, { status: 400 })
  }
  if (authResult.auth.user && !(await userCanAccessClient(supabase, authResult.auth.user.id, client_id))) {
    return forbiddenResponse()
  }

  // Get all clients with GSC connections
  let connQuery = supabase
    .from('google_connections')
    .select('id, client_id, workspace_id')
    .in('status', ['active', 'connected'])
  if (client_id) connQuery = connQuery.eq('client_id', client_id) as any
  const { data: connections } = await connQuery

  if (!connections || connections.length === 0) {
    return NextResponse.json({ flagged: 0 })
  }

  let totalFlagged = 0

  for (const conn of connections) {
    const now = new Date()
    const day28 = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const day56 = new Date(now.getTime() - 56 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const today = now.toISOString().split('T')[0]

    // Current period: last 28 days
    const { data: current } = await supabase
      .from('search_performance')
      .select('query, position, impressions')
      .eq('client_id', conn.client_id)
      .gte('period_end', day28)
      .lte('period_end', today)

    // Previous period: 28-56 days ago
    const { data: previous } = await supabase
      .from('search_performance')
      .select('query, position, impressions')
      .eq('client_id', conn.client_id)
      .gte('period_end', day56)
      .lt('period_end', day28)

    if (!current || !previous) continue

    // Build maps
    const prevMap: Record<string, { position: number; impressions: number }> = {}
    for (const r of previous) {
      if (!prevMap[r.query]) prevMap[r.query] = { position: r.position, impressions: r.impressions }
    }

    for (const r of current) {
      const prev = prevMap[r.query]
      if (!prev) continue
      const worsened = r.position - prev.position
      if (worsened > 3 && r.impressions > 50) {
        // Flag as decay
        const { data: existingClient } = await supabase
          .from('client_profiles')
          .select('name')
          .eq('id', conn.client_id)
          .single()

        await supabase.from('briefing_items').insert({
          client_id: conn.client_id,
          workspace_id: conn.workspace_id || null,
          type: 'decay',
          title: `Average position drop: "${r.query}"`,
          body: `"${r.query}" worsened from average position ${prev.position.toFixed(1)} to ${r.position.toFixed(1)} (${worsened.toFixed(1)} positions). ${r.impressions} impressions at risk. Review and refresh this content.`,
          action_url: `/clients/${conn.client_id}?tab=search`,
          priority: Math.round(r.impressions / 10),
          dismissed: false,
        })
        totalFlagged++

        // Log to agent_activity
        await supabase.from('agent_activity').insert({
          client_id: conn.client_id,
          workspace_id: conn.workspace_id || null,
          action: 'decay_detected',
          detail: `Average position decay: "${r.query}" worsened ${worsened.toFixed(1)} positions (${r.impressions} impressions)`,
          tokens_used: 0,
        })
      }
    }
  }

  return NextResponse.json({ flagged: totalFlagged })
}
