import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type RouteUser = {
  id: string
  email?: string
}

export type RouteAuthContext = {
  user: RouteUser | null
  isInternal: boolean
}

let adminClient: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set')
  if (!key) throw new Error('SUPABASE_SERVICE_KEY not set')
  if (!adminClient) {
    adminClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return adminClient
}

function bearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || ''
  const match = auth.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export async function getRouteAuth(req: NextRequest): Promise<RouteAuthContext> {
  const token = bearerToken(req)
  const cronSecret = process.env.CRON_SECRET

  if (token && cronSecret && token === cronSecret) {
    return { user: null, isInternal: true }
  }

  if (!token) return { user: null, isInternal: false }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return { user: null, isInternal: false }

  return {
    user: { id: data.user.id, email: data.user.email || undefined },
    isInternal: false,
  }
}

export async function requireUser(req: NextRequest): Promise<
  | { ok: true; auth: RouteAuthContext & { user: RouteUser } }
  | { ok: false; response: NextResponse }
> {
  const auth = await getRouteAuth(req)
  if (!auth.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    }
  }
  return { ok: true, auth: auth as RouteAuthContext & { user: RouteUser } }
}

export async function requireUserOrInternal(req: NextRequest): Promise<
  | { ok: true; auth: RouteAuthContext }
  | { ok: false; response: NextResponse }
> {
  const auth = await getRouteAuth(req)
  if (!auth.user && !auth.isInternal) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    }
  }
  return { ok: true, auth }
}

export async function requireInternal(req: NextRequest): Promise<
  | { ok: true; auth: RouteAuthContext }
  | { ok: false; response: NextResponse }
> {
  const auth = await getRouteAuth(req)
  if (!auth.isInternal) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Internal route requires Bearer CRON_SECRET' }, { status: 401 }),
    }
  }
  return { ok: true, auth }
}

export async function userCanAccessClient(
  supabase: SupabaseClient,
  userId: string,
  clientId: string,
): Promise<boolean> {
  const { data: client } = await supabase
    .from('client_profiles')
    .select('user_id,workspace_id')
    .eq('id', clientId)
    .maybeSingle()

  if (!client) return false
  if (client.user_id === userId) return true
  if (!client.workspace_id) return false

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('id', client.workspace_id)
    .eq('owner_id', userId)
    .maybeSingle()

  return !!workspace
}

export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: 'You do not have access to this resource' }, { status: 403 })
}

