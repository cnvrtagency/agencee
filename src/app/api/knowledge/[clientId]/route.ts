import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

export async function GET(_req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  const { data } = await supabase
    .from('client_knowledge')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
  return NextResponse.json({ knowledge: data })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  const body = await req.json()

  const { data, error } = await supabase
    .from('client_knowledge')
    .upsert(
      { client_id: clientId, ...body, updated_at: new Date().toISOString() },
      { onConflict: 'client_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ knowledge: data })
}
