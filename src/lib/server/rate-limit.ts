import { NextRequest, NextResponse } from 'next/server'

type Bucket = {
  count: number
  resetAt: number
}

type RateLimitOptions = {
  key: string
  limit: number
  windowMs: number
}

declare global {
  // eslint-disable-next-line no-var
  var __agenceeRateLimits: Map<string, Bucket> | undefined
}

const buckets = globalThis.__agenceeRateLimits || new Map<string, Bucket>()
globalThis.__agenceeRateLimits = buckets

export function getRateLimitIdentity(req: NextRequest, userId?: string | null): string {
  if (userId) return `user:${userId}`
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = req.headers.get('x-real-ip')?.trim()
  return `ip:${forwarded || realIp || 'unknown'}`
}

export function checkRateLimit({ key, limit, windowMs }: RateLimitOptions):
  | { ok: true }
  | { ok: false; response: NextResponse } {
  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }

  if (existing.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${retryAfter} seconds.` },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      ),
    }
  }

  existing.count += 1
  return { ok: true }
}

