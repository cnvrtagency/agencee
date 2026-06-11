import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/crypto'
import { requireUser } from '@/lib/server/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const { anthropic_api_key, gemini_api_key } = await req.json()
  const user_id = authResult.auth.user.id

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  try {
    if (anthropic_api_key !== undefined) {
      updates.anthropic_api_key = anthropic_api_key ? encrypt(anthropic_api_key) : null
    }
    if (gemini_api_key !== undefined) {
      updates.gemini_api_key = gemini_api_key ? encrypt(gemini_api_key) : null
    }
  } catch (err: any) {
    return NextResponse.json({
      error: `Failed to encrypt API key: ${err.message}. ENCRYPTION_KEY must be a 32-byte base64 string.`,
    }, { status: 500 })
  }

  const { error } = await supabase
    .from('workspace_settings')
    .update(updates)
    .eq('user_id', user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
