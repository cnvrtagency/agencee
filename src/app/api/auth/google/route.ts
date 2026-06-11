import { NextRequest, NextResponse } from 'next/server'
import { createGoogleOAuthState } from '@/lib/server/oauth-state'
import { forbiddenResponse, requireUser, userCanAccessClient } from '@/lib/server/auth'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('client_id') || ''
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })
  if (!(await userCanAccessClient(supabase, authResult.auth.user.id, clientId))) return forbiddenResponse()
  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: 'GOOGLE_CLIENT_ID not set in environment variables' }, { status: 500 })
  }
  if (!process.env.NEXT_PUBLIC_SITE_URL) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_SITE_URL not set in environment variables' }, { status: 500 })
  }

  let state: string
  try {
    state = createGoogleOAuthState({
      client_id: clientId,
      user_id: authResult.auth.user.id,
      nonce: crypto.randomUUID(),
      exp: Date.now() + 10 * 60 * 1000,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  googleAuthUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID)
  googleAuthUrl.searchParams.set('redirect_uri', `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/google/callback`)
  googleAuthUrl.searchParams.set('response_type', 'code')
  googleAuthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/userinfo.email')
  googleAuthUrl.searchParams.set('access_type', 'offline')
  googleAuthUrl.searchParams.set('prompt', 'consent')
  googleAuthUrl.searchParams.set('state', state)

  return NextResponse.json({ url: googleAuthUrl.toString() })
}
