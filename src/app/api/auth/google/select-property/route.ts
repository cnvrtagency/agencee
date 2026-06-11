import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { connection_id, site_url, client_id, workspace_id, access_token, refresh_token, expires_at, email } = body

  if (!site_url) return NextResponse.json({ error: 'site_url required' }, { status: 400 })

  // CREATE mode — first-time save from OAuth callback
  if (client_id && access_token) {
    const { error } = await supabase.from('google_connections').upsert({
      client_id,
      workspace_id: workspace_id || null,
      google_account_email: email || null,
      property_url: site_url,
      access_token: encrypt(access_token),
      refresh_token: refresh_token ? encrypt(refresh_token) : null,
      token_expires_at: expires_at || new Date(Date.now() + 3600 * 1000).toISOString(),
      status: 'active',
      connected_at: new Date().toISOString(),
    }, { onConflict: 'client_id' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // UPDATE mode — change property on existing connection
  if (!connection_id) return NextResponse.json({ error: 'connection_id or client_id+access_token required' }, { status: 400 })

  const { error } = await supabase
    .from('google_connections')
    .update({ property_url: site_url, status: 'active', updated_at: new Date().toISOString() })
    .eq('id', connection_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
