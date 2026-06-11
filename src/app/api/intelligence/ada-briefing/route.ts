import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// POST /api/intelligence/ada-briefing
// Called when Ada wants to create proactive briefing items after analysis.
// Body: { client_id: string, agent_id?: string, items: [{ type, title, body, priority }] }
export async function POST(req: NextRequest) {
  const { client_id, agent_id, items } = await req.json()

  if (!client_id) return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: 'items array is required' }, { status: 400 })

  const { data: client } = await supabase
    .from('client_profiles')
    .select('id, name, workspace_id')
    .eq('id', client_id)
    .single()

  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const workspace_id = client.workspace_id || null

  const rows = items.map((item: any) => ({
    client_id,
    workspace_id,
    type: item.type || 'opportunity',
    title: item.title,
    body: item.body || '',
    priority: item.priority ?? 50,
    dismissed: false,
    action_url: item.action_url || null,
    action_label: item.action_label || null,
  }))

  const { data: inserted, error } = await supabase
    .from('briefing_items')
    .upsert(rows, { onConflict: 'client_id,title' })
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (agent_id) {
    await supabase.from('agent_activity').insert({
      agent_id,
      client_id,
      workspace_id,
      action: 'briefing_created',
      detail: `${rows.length} briefing item${rows.length !== 1 ? 's' : ''} created`,
      tokens_used: 0,
    })
  }

  return NextResponse.json({ ok: true, created: (inserted || []).length })
}
