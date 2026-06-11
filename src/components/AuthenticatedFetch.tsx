'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function AuthenticatedFetch() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window)

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      const isApiRoute = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`)
      if (!isApiRoute) return originalFetch(input, init)

      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
      if (!headers.has('Authorization')) {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (token) headers.set('Authorization', `Bearer ${token}`)
      }

      return originalFetch(input, { ...init, headers })
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  return null
}
