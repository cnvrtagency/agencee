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

  const { suggestion_id } = await req.json()

  const { data: suggestion, error: loadError } = await supabase
    .from('keyword_suggestions')
    .select('*')
    .eq('id', suggestion_id)
    .single()

  if (loadError || !suggestion) {
    return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
  }
  if (!(await userCanAccessClient(supabase, authResult.auth.user.id, suggestion.client_id))) return forbiddenResponse()

  const keyword = suggestion.keyword.toLowerCase()
  const isInformational = /^(what|how|why|when|does|is|are|can|should|do)\b/.test(keyword)
  const isLocal = /near me|near you|\bnearby\b|\blocal\b|\bnear\b/.test(keyword)
  const intent = isInformational ? 'informational' : 'commercial'
  const funnel_stage = isInformational ? 'tofu' : isLocal ? 'bofu' : 'mofu'

  const meta = suggestion.metadata as any
  const position = meta?.position || null
  const opportunity_score = position
    ? (position <= 10 ? 60 : position <= 20 ? 75 : 50)
    : 50

  // keyword_banks columns: id, client_id, keyword, cluster, intent, funnel_stage,
  // monthly_volume, difficulty, current_position, content_targeting_this, priority,
  // created_at, user_id, workspace_id, opportunity_score
  const insertObj: any = {
    workspace_id: suggestion.workspace_id,
    user_id: suggestion.user_id || authResult.auth.user.id,
    client_id: suggestion.client_id,
    keyword: suggestion.keyword,
    intent,
    funnel_stage,
    priority: 5,
    opportunity_score,
  }

  if (meta?.impressions !== undefined) insertObj.monthly_volume = Math.round(meta.impressions)
  if (position !== null) insertObj.current_position = Math.round(position * 10) / 10
  if (meta?.difficulty !== undefined) insertObj.difficulty = Math.round(meta.difficulty)

  const { data: banked, error: bankError } = await supabase
    .from('keyword_banks')
    .insert(insertObj)
    .select()
    .single()

  if (bankError) {
    console.error('[keywords/approve] keyword_banks insert failed:', bankError.message)
    return NextResponse.json({ error: bankError.message }, { status: 500 })
  }

  // Update suggestion status (no reviewed_at column)
  await supabase
    .from('keyword_suggestions')
    .update({ status: 'approved' })
    .eq('id', suggestion_id)

  return NextResponse.json({ success: true, keyword_bank_id: banked.id })
}
