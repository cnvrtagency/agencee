import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('client_id') || ''
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })
  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: 'GOOGLE_CLIENT_ID not set in environment variables' }, { status: 500 })
  }
  if (!process.env.NEXT_PUBLIC_SITE_URL) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_SITE_URL not set in environment variables' }, { status: 500 })
  }

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  googleAuthUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID)
  googleAuthUrl.searchParams.set('redirect_uri', `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/google/callback`)
  googleAuthUrl.searchParams.set('response_type', 'code')
  googleAuthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/userinfo.email')
  googleAuthUrl.searchParams.set('access_type', 'offline')
  googleAuthUrl.searchParams.set('prompt', 'consent')
  googleAuthUrl.searchParams.set('state', clientId)

  return NextResponse.redirect(googleAuthUrl.toString())
}
