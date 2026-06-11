import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forbiddenResponse, requireUser, userCanAccessClient } from '@/lib/server/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const { suggestion_id, reason } = await req.json()

  const { data: suggestion } = await supabase
    .from('keyword_suggestions')
    .select('metadata,client_id')
    .eq('id', suggestion_id)
    .single()

  if (!suggestion) return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
  if (!(await userCanAccessClient(supabase, authResult.auth.user.id, suggestion.client_id))) return forbiddenResponse()

  const { error } = await supabase
    .from('keyword_suggestions')
    .update({
      status: 'rejected',
      metadata: { ...(suggestion?.metadata as any || {}), reject_reason: reason || null }
    })
    .eq('id', suggestion_id)

  if (error) {
    console.error('[keywords/reject] failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
