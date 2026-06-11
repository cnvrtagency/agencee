import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encrypt, safeDecrypt } from '@/lib/crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  const { connection_id } = await req.json().catch(() => ({}))
  if (!connection_id) return NextResponse.json({ error: 'connection_id required' }, { status: 400 })

  const { data: conn, error } = await supabase
    .from('google_connections')
    .select('*')
    .eq('id', connection_id)
    .single()
  if (error || !conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  const refreshToken = conn.refresh_token ? safeDecrypt(conn.refresh_token) : null
  if (!refreshToken) return NextResponse.json({ error: 'No refresh token available' }, { status: 400 })

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const tokens = await tokenRes.json()
  if (tokens.error) return NextResponse.json({ error: tokens.error_description || 'Token refresh failed' }, { status: 400 })

  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()
  await supabase.from('google_connections').update({
    access_token: encrypt(tokens.access_token),
    token_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq('id', connection_id)

  return NextResponse.json({ access_token: tokens.access_token })
}
