import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(_req: NextRequest) {
  // Get all clients with GSC connections
  const { data: connections } = await supabase
    .from('google_connections')
    .select('id, client_id')
    .eq('status', 'active')

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
          type: 'decay',
          title: `Ranking drop: "${r.query}"`,
          body: `"${r.query}" dropped from #${prev.position.toFixed(0)} to #${r.position.toFixed(0)} (${worsened.toFixed(0)} positions). ${r.impressions} impressions at risk. Review and refresh this content.`,
          action_url: `/clients/${conn.client_id}?tab=search`,
          priority: Math.round(r.impressions / 10),
          dismissed: false,
        })
        totalFlagged++

        // Log to agent_activity
        await supabase.from('agent_activity').insert({
          client_id: conn.client_id,
          action: 'decay_detected',
          detail: `Ranking decay: "${r.query}" dropped ${worsened.toFixed(0)} positions (${r.impressions} impressions)`,
          tokens_used: 0,
        })
      }
    }
  }

  return NextResponse.json({ flagged: totalFlagged })
}
