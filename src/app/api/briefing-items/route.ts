import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// GET /api/briefing-items?dismissed=false&limit=50
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const dismissed = searchParams.get('dismissed')
  const limit = parseInt(searchParams.get('limit') || '50', 10)

  let q = supabase
    .from('briefing_items')
    .select('*', { count: 'exact' })
    .order('priority', { ascending: false })
    .limit(limit)

  if (dismissed !== null) q = q.eq('dismissed', dismissed === 'true') as typeof q

  const { data, count, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, count })
}

// POST /api/briefing-items  body: briefing item fields
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { client_id, type, title, body: itemBody, action_url, priority, dismissed } = body
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })

  const { error } = await supabase.from('briefing_items').insert({
    client_id,
    type,
    title,
    body: itemBody,
    action_url: action_url ?? null,
    priority: priority ?? 0,
    dismissed: dismissed ?? false,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// PATCH /api/briefing-items  body: { id?, ids?, dismissed }
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ids, dismissed } = body

  if (id) {
    const { error } = await supabase.from('briefing_items').update({ dismissed }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (ids && Array.isArray(ids)) {
    const { error } = await supabase.from('briefing_items').update({ dismissed }).in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    return NextResponse.json({ error: 'id or ids required' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
