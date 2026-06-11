import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getValidAccessToken } from '@/lib/gsc'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const connection_id = searchParams.get('connection_id')
  if (!connection_id) return NextResponse.json({ error: 'connection_id required' }, { status: 400 })

  const { data: conn } = await supabase
    .from('google_connections')
    .select('*')
    .eq('id', connection_id)
    .single()

  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  let accessToken: string
  try {
    accessToken = await getValidAccessToken(conn.id)
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to get access token: ${e.message}` }, { status: 400 })
  }

  const res = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const err = await res.json()
    return NextResponse.json({ error: err.error?.message || 'GSC API error' }, { status: 400 })
  }

  const data = await res.json()
  const properties = (data.siteEntry || []).map((s: any) => s.siteUrl)
  return NextResponse.json({ properties })
}
