import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// GET /api/agent-activity?agent_id=...&page=0&page_size=50
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const agent_id = searchParams.get('agent_id')
  const client_id = searchParams.get('client_id')
  const page = parseInt(searchParams.get('page') || '0', 10)
  const page_size = parseInt(searchParams.get('page_size') || '50', 10)
  const totals_only = searchParams.get('totals_only') === 'true'

  let q = supabase
    .from('agent_activity')
    .select('*, agents(name), client_profiles(name)')
    .order('created_at', { ascending: false })

  if (agent_id) q = q.eq('agent_id', agent_id) as typeof q
  if (client_id) q = q.eq('client_id', client_id) as typeof q

  if (totals_only) {
    // Return just tokens_used for all matching rows (no pagination)
    let tq = supabase.from('agent_activity').select('tokens_used')
    if (agent_id) tq = tq.eq('agent_id', agent_id) as typeof tq
    if (client_id) tq = tq.eq('client_id', client_id) as typeof tq
    const { data, error } = await tq
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data })
  }

  q = q.range(page * page_size, page * page_size + page_size) as typeof q

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// POST /api/agent-activity  body: { agent_id, client_id, action, detail, tokens_used }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { agent_id, client_id, action, detail, tokens_used } = body
  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  const { error } = await supabase.from('agent_activity').insert({
    agent_id,
    client_id,
    action,
    detail,
    tokens_used: tokens_used ?? 0,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
