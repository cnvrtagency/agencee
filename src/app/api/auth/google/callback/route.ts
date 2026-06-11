import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { encrypt } from '@/lib/crypto'
import { verifyGoogleOAuthState } from '@/lib/server/oauth-state'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = verifyGoogleOAuthState(searchParams.get('state'))
  const error = searchParams.get('error')

  if (!state) {
    return NextResponse.redirect(`${BASE_URL}/clients?gsc=error&message=invalid_state`)
  }

  const clientId = state.client_id
  const userId = state.user_id

  if (error || !code) {
    return NextResponse.redirect(`${BASE_URL}/clients/${clientId}?tab=connections&gsc=error`)
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error('[auth/google/callback] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set')
    return NextResponse.redirect(`${BASE_URL}/clients/${clientId}?tab=connections&gsc=error&message=missing_env`)
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${BASE_URL}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  })
  const tokens = await tokenRes.json()
  if (tokens.error) {
    console.error('[auth/google/callback] token exchange error:', tokens.error)
    return NextResponse.redirect(`${BASE_URL}/clients/${clientId}?tab=connections&gsc=error`)
  }

  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const userInfo = await userInfoRes.json()

  const sitesRes = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const sitesData = await sitesRes.json()
  console.log('[auth/google/callback] GSC sites response:', JSON.stringify(sitesData))

  const validProperties = (sitesData.siteEntry || []).filter((s: any) =>
    ['siteOwner', 'siteFullUser', 'siteRestrictedUser'].includes(s.permissionLevel)
  )
  console.log('[auth/google/callback] valid properties:', validProperties.length, validProperties.map((p: any) => p.siteUrl))

  const { data: clientProfile } = await supabase
    .from('client_profiles')
    .select('workspace_id,user_id')
    .eq('id', clientId)
    .single()

  if (!clientProfile || (clientProfile.user_id && clientProfile.user_id !== userId)) {
    return NextResponse.redirect(`${BASE_URL}/clients?gsc=error&message=invalid_client`)
  }

  const workspaceId = clientProfile?.workspace_id || null

  const saveConnection = async (propertyUrl: string) => {
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()
    const { error: upsertError } = await supabase.from('google_connections').upsert({
      client_id: clientId,
      workspace_id: workspaceId,
      google_account_email: userInfo.email,
      property_url: propertyUrl,
      access_token: encrypt(tokens.access_token),
      refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      token_expires_at: expiresAt,
      status: 'active',
    }, { onConflict: 'client_id' })
    if (upsertError) console.error('[auth/google/callback] upsert error:', upsertError.message)
  }

  if (validProperties.length === 1) {
    await saveConnection(validProperties[0].siteUrl)
    return NextResponse.redirect(`${BASE_URL}/clients/${clientId}?tab=connections&gsc=connected`)
  } else if (validProperties.length > 1) {
    const sessionId = randomUUID()
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()
    const { error: sessionError } = await supabase.from('google_oauth_sessions').insert({
      id: sessionId,
      client_id: clientId,
      user_id: userId,
      workspace_id: workspaceId,
      google_account_email: userInfo.email || null,
      properties: validProperties.map((p: any) => p.siteUrl),
      access_token: encrypt(tokens.access_token),
      refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      token_expires_at: expiresAt,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })
    if (sessionError) {
      console.error('[auth/google/callback] oauth session insert error:', sessionError.message)
      return NextResponse.redirect(`${BASE_URL}/clients/${clientId}?tab=connections&gsc=error`)
    }
    return NextResponse.redirect(`${BASE_URL}/clients/${clientId}/gsc-setup?session_id=${sessionId}`)
  } else {
    return NextResponse.redirect(`${BASE_URL}/clients/${clientId}?tab=connections&gsc=error&message=no_properties`)
  }
}
