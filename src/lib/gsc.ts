import { createClient } from '@supabase/supabase-js'
import { encrypt, safeDecrypt } from '@/lib/crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

export async function getValidAccessToken(connectionId: string): Promise<string> {
  const { data: conn } = await supabase
    .from('google_connections')
    .select('access_token, refresh_token, token_expires_at')
    .eq('id', connectionId)
    .single()

  if (!conn) throw new Error('Google connection not found')
  if (!conn.refresh_token) throw new Error('No refresh token stored — reconnect Google Search Console from the client Connections tab')

  // Return cached token if still valid (5-min buffer)
  const expiry = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0
  if (conn.access_token && expiry > Date.now() + 5 * 60 * 1000) {
    return safeDecrypt(conn.access_token) || conn.access_token
  }

  // Refresh directly with Google
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set in environment variables')
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: safeDecrypt(conn.refresh_token) || conn.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  const data = await res.json()

  if (!res.ok || !data.access_token) {
    await supabase.from('google_connections').update({
      status: 'needs_reconnect',
      updated_at: new Date().toISOString(),
    }).eq('id', connectionId)

    throw new Error(
      `Token refresh failed: ${data.error_description || data.error || `HTTP ${res.status}`}. Reconnect Google Search Console from the client Connections tab.`
    )
  }

  // Store new access token
  await supabase.from('google_connections').update({
    access_token: encrypt(data.access_token),
    token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
    status: 'active',
    updated_at: new Date().toISOString(),
  }).eq('id', connectionId)

  return data.access_token
}
