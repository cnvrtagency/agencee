import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendNotification } from '@/lib/notifications'
import { forbiddenResponse, requireUser } from '@/lib/server/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const { workspace_id, output_id, title, client_name, primary_keyword, word_count } = await req.json()
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 })
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('id', workspace_id)
    .eq('owner_id', authResult.auth.user.id)
    .maybeSingle()
  if (!workspace) return forbiddenResponse()

  const wc = word_count ? ` (${word_count.toLocaleString()} words)` : ''
  await sendNotification({
    workspaceId: workspace_id,
    type: 'output_ready',
    subject: `Content ready for review — ${title || 'New draft'}`,
    body: `Ada has produced a new draft for ${client_name || 'your client'}.\n\nTitle: ${title || 'Untitled'}\nKeyword: ${primary_keyword || '—'}${wc}\n\nReview it in your Agencee dashboard.`,
    actionUrl: output_id ? `/outputs/${output_id}` : undefined,
  })

  return NextResponse.json({ ok: true })
}
