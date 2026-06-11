import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  const { suggestion_id, reason } = await req.json()

  const { data: suggestion } = await supabase
    .from('keyword_suggestions')
    .select('metadata')
    .eq('id', suggestion_id)
    .single()

  const { error } = await supabase
    .from('keyword_suggestions')
    .update({
      status: 'rejected',
      metadata: { ...(suggestion?.metadata as any || {}), reject_reason: reason || null }
    })
    .eq('id', suggestion_id)

  if (error) {
    console.error('keyword reject failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
