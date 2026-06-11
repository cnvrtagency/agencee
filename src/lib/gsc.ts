import { createClient } from '@supabase/supabase-js'
import { safeDecrypt } from '@/lib/crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

export async function getValidAccessToken(connectionId: string): Promise<string> {
  const { data: conn } = await supabase
    .from('google_connections')
    .select('*')
    .eq('id', connectionId)
    .single()

  if (!conn) throw new Error('Connection not found')

  const isExpired = !conn.token_expires_at || new Date(conn.token_expires_at) <= new Date(Date.now() + 60_000)

  if (!isExpired) {
    const token = conn.access_token ? safeDecrypt(conn.access_token) : null
    if (token) return token
  }

  // Refresh the token
  const res = await fetch(`${BASE_URL}/api/auth/google/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connection_id: connectionId }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Token refresh failed: ${data.error}`)
  return data.access_token
}
