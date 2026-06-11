import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  const { workspace_id, user_id, anthropic_api_key, gemini_api_key } = await req.json()
  if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (anthropic_api_key !== undefined) {
    updates.anthropic_api_key = anthropic_api_key ? encrypt(anthropic_api_key) : null
  }
  if (gemini_api_key !== undefined) {
    updates.gemini_api_key = gemini_api_key ? encrypt(gemini_api_key) : null
  }

  const { error } = await supabase
    .from('workspace_settings')
    .update(updates)
    .eq('user_id', user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
