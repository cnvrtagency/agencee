import { NextRequest, NextResponse } from 'next/server'
import { forbiddenResponse, getSupabaseAdmin, requireUser, userCanAccessClient } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  try {
    const { client_id, agent_slug, workspace_id, notes } = await req.json()
    if (!client_id || !agent_slug || !notes) {
      return NextResponse.json({ error: 'client_id, agent_slug, notes required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    if (!(await userCanAccessClient(supabase, authResult.auth.user.id, client_id))) return forbiddenResponse()

    const { data: existing, error: loadError } = await supabase
      .from('client_knowledge')
      .select('agent_notes')
      .eq('client_id', client_id)
      .maybeSingle()

    if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })

    const currentNotes = (existing?.agent_notes as Record<string, any>) || {}
    const { error } = await supabase
      .from('client_knowledge')
      .upsert({
        client_id,
        workspace_id: workspace_id || null,
        agent_notes: {
          ...currentNotes,
          [agent_slug]: notes,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to write debrief notes' }, { status: 500 })
  }
}
