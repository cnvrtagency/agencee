import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

const publicPaths = ['/login', '/signup', '/onboarding']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Always allow public paths and API routes
  if (publicPaths.some(p => pathname.startsWith(p)) || pathname.startsWith('/api')) {
    return NextResponse.next()
  }

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

  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Redirect to onboarding if not yet set up
  if (pathname !== '/onboarding') {
    const { data: ws } = await supabase.from('workspace_settings').select('onboarded').eq('user_id', user.id).maybeSingle()
    if (!ws?.onboarded) {
      return NextResponse.redirect(new URL('/onboarding', req.url))
    }
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
