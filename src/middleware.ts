import { NextRequest, NextResponse } from 'next/server'

// Auth enforcement is disabled until the Supabase migration has been run.
// To enable: run supabase/migration_saas.sql in the Supabase SQL Editor,
// then set NEXT_PUBLIC_AUTH_ENABLED=true in .env.local.
const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true'

const publicPaths = ['/login', '/signup', '/onboarding']

export async function middleware(req: NextRequest) {
  if (!AUTH_ENABLED) return NextResponse.next()

  const { pathname } = req.nextUrl
  if (publicPaths.some(p => pathname.startsWith(p)) || pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  // Dynamically import to avoid edge runtime issues when auth is disabled
  const { createServerClient } = await import('@supabase/ssr')
  const res = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookies) => cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  if (pathname !== '/onboarding') {
    const { data: ws } = await supabase.from('workspace_settings').select('onboarding_completed').eq('user_id', user.id).maybeSingle()
    if (!ws?.onboarding_completed) return NextResponse.redirect(new URL('/onboarding', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
