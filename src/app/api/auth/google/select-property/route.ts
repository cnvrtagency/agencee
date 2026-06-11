import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forbiddenResponse, requireUser, userCanAccessClient } from '@/lib/server/auth'
import { readJsonWithLimit } from '@/lib/server/request-body'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const sessionId = new URL(req.url).searchParams.get('session_id')
  if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

  const { data: session } = await supabase
    .from('google_oauth_sessions')
    .select('id,client_id,user_id,properties,expires_at')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session) return NextResponse.json({ error: 'OAuth session not found or expired' }, { status: 404 })
  if (session.expires_at && new Date(session.expires_at) <= new Date()) {
    await supabase.from('google_oauth_sessions').delete().eq('id', sessionId)
    return NextResponse.json({ error: 'OAuth session expired. Connect GSC again.' }, { status: 410 })
  }
  if (session.user_id !== authResult.auth.user.id) return forbiddenResponse()
  if (!(await userCanAccessClient(supabase, authResult.auth.user.id, session.client_id))) return forbiddenResponse()

  return NextResponse.json({ properties: Array.isArray(session.properties) ? session.properties : [] })
}

export async function POST(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const bodyResult = await readJsonWithLimit<any>(req, 8_000)
  if (!bodyResult.ok) return bodyResult.response
  const { connection_id, site_url, session_id } = bodyResult.data

  if (!site_url) return NextResponse.json({ error: 'site_url required' }, { status: 400 })

  // CREATE mode — first-time save from OAuth callback. Tokens stay server-side in google_oauth_sessions.
  if (session_id) {
    const { data: session } = await supabase
      .from('google_oauth_sessions')
      .select('*')
      .eq('id', session_id)
      .maybeSingle()

    if (!session) return NextResponse.json({ error: 'OAuth session not found or expired' }, { status: 404 })
    if (session.expires_at && new Date(session.expires_at) <= new Date()) {
      await supabase.from('google_oauth_sessions').delete().eq('id', session_id)
      return NextResponse.json({ error: 'OAuth session expired. Connect GSC again.' }, { status: 410 })
    }
    if (session.user_id !== authResult.auth.user.id) return forbiddenResponse()
    if (!(await userCanAccessClient(supabase, authResult.auth.user.id, session.client_id))) return forbiddenResponse()
    const properties = Array.isArray(session.properties) ? session.properties : []
    if (!properties.includes(site_url)) return NextResponse.json({ error: 'Selected property is not in this OAuth session' }, { status: 400 })

    const { error } = await supabase.from('google_connections').upsert({
      client_id: session.client_id,
      workspace_id: session.workspace_id || null,
      google_account_email: session.google_account_email || null,
      property_url: site_url,
      access_token: session.access_token,
      refresh_token: session.refresh_token || null,
      token_expires_at: session.token_expires_at || new Date(Date.now() + 3600 * 1000).toISOString(),
      status: 'active',
      connected_at: new Date().toISOString(),
    }, { onConflict: 'client_id' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await supabase.from('google_oauth_sessions').delete().eq('id', session_id)
    return NextResponse.json({ ok: true })
  }

  // UPDATE mode — change property on existing connection
  if (!connection_id) return NextResponse.json({ error: 'connection_id or session_id required' }, { status: 400 })
  const { data: conn } = await supabase.from('google_connections').select('client_id').eq('id', connection_id).maybeSingle()
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  if (!(await userCanAccessClient(supabase, authResult.auth.user.id, conn.client_id))) return forbiddenResponse()

  const { error } = await supabase
    .from('google_connections')
    .update({ property_url: site_url, status: 'active', updated_at: new Date().toISOString() })
    .eq('id', connection_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
