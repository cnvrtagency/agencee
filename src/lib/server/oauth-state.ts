import { createHmac, timingSafeEqual } from 'crypto'

export type GoogleOAuthState = {
  client_id: string
  user_id: string
  nonce: string
  exp: number
}

function getStateSecret() {
  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.GOOGLE_CLIENT_SECRET || process.env.CRON_SECRET
  if (!secret) throw new Error('GOOGLE_OAUTH_STATE_SECRET or GOOGLE_CLIENT_SECRET is required')
  return secret
}

function toBase64Url(value: string) {
  return Buffer.from(value).toString('base64url')
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function sign(payload: string) {
  return createHmac('sha256', getStateSecret()).update(payload).digest('base64url')
}

export function createGoogleOAuthState(payload: GoogleOAuthState) {
  const encoded = toBase64Url(JSON.stringify(payload))
  return `${encoded}.${sign(encoded)}`
}

export function verifyGoogleOAuthState(state: string | null): GoogleOAuthState | null {
  if (!state) return null
  const [encoded, signature] = state.split('.')
  if (!encoded || !signature) return null

  const expected = sign(encoded)
  const signatureBuffer = Buffer.from(signature, 'base64url')
  const expectedBuffer = Buffer.from(expected, 'base64url')
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) return null

  try {
    const payload = JSON.parse(fromBase64Url(encoded)) as GoogleOAuthState
    if (!payload.client_id || !payload.user_id || !payload.exp || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
