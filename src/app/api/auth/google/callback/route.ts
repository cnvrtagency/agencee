import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(`${BASE_URL}/clients/${state}?tab=connections&gsc=error`)
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: `${BASE_URL}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  })
  const tokens = await tokenRes.json()
  if (tokens.error) {
    console.error('Token exchange error:', tokens.error)
    return NextResponse.redirect(`${BASE_URL}/clients/${state}?tab=connections&gsc=error`)
  }

  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const userInfo = await userInfoRes.json()

  const sitesRes = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const sitesData = await sitesRes.json()
  console.log('GSC sites response:', JSON.stringify(sitesData))

  const validProperties = (sitesData.siteEntry || []).filter((s: any) =>
    ['siteOwner', 'siteFullUser', 'siteRestrictedUser'].includes(s.permissionLevel)
  )
  console.log('Valid properties:', validProperties.length, validProperties.map((p: any) => p.siteUrl))

  const { data: clientProfile } = await supabase
    .from('client_profiles')
    .select('workspace_id')
    .eq('id', state)
    .single()

  const workspaceId = clientProfile?.workspace_id || null

  const saveConnection = async (propertyUrl: string) => {
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()
    const { error: upsertError } = await supabase.from('google_connections').upsert({
      client_id: state,
      workspace_id: workspaceId,
      google_account_email: userInfo.email,
      property_url: propertyUrl,
      access_token: encrypt(tokens.access_token),
      refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      token_expires_at: expiresAt,
      status: 'active',
    }, { onConflict: 'client_id' })
    if (upsertError) console.error('Upsert error:', upsertError)
  }

  if (validProperties.length === 1) {
    await saveConnection(validProperties[0].siteUrl)
    return NextResponse.redirect(`${BASE_URL}/clients/${state}?tab=connections&gsc=connected`)
  } else if (validProperties.length > 1) {
    const params = new URLSearchParams({
      properties: Buffer.from(JSON.stringify(validProperties.map((p: any) => p.siteUrl))).toString('base64'),
      access_token: Buffer.from(tokens.access_token).toString('base64'),
      refresh_token: tokens.refresh_token ? Buffer.from(tokens.refresh_token).toString('base64') : '',
      expires_in: String(tokens.expires_in || 3600),
      email: userInfo.email || '',
    })
    return NextResponse.redirect(`${BASE_URL}/clients/${state}/gsc-setup?${params.toString()}`)
  } else {
    return NextResponse.redirect(`${BASE_URL}/clients/${state}?tab=connections&gsc=error&message=no_properties`)
  }
}
