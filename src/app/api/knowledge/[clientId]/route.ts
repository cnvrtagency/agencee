import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forbiddenResponse, requireUser, userCanAccessClient } from '@/lib/server/auth'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

export async function GET(_req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const authResult = await requireUser(_req)
  if (!authResult.ok) return authResult.response

  const { clientId } = await params
  if (!(await userCanAccessClient(supabase, authResult.auth.user.id, clientId))) return forbiddenResponse()
  const { data } = await supabase
    .from('client_knowledge')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
  return NextResponse.json({ knowledge: data })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const { clientId } = await params
  if (!(await userCanAccessClient(supabase, authResult.auth.user.id, clientId))) return forbiddenResponse()
  const body = await req.json()
  const { data: client } = await supabase.from('client_profiles').select('workspace_id').eq('id', clientId).maybeSingle()

  const { data, error } = await supabase
    .from('client_knowledge')
    .upsert(
      { client_id: clientId, ...body, workspace_id: client?.workspace_id || body.workspace_id || null, updated_at: new Date().toISOString() },
      { onConflict: 'client_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ knowledge: data })
}
