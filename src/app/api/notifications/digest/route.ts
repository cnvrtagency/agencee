import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendNotification } from '@/lib/notifications'
import { requireInternal } from '@/lib/server/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  const authResult = await requireInternal(req)
  if (!authResult.ok) return authResult.response

  const { data: workspaces } = await supabase.from('workspaces').select('id, name')
  if (!workspaces || workspaces.length === 0) return NextResponse.json({ sent: 0 })

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  let sent = 0

  for (const ws of workspaces) {
    // Count outputs created in last 24h not approved (drafts ready for review)
    const { count: draftCount } = await supabase
      .from('content_outputs')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ws.id)
      .eq('approved', false)
      .gte('created_at', yesterday)

    // Count pending keyword suggestions
    const { count: kwCount } = await supabase
      .from('keyword_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ws.id)
      .eq('status', 'pending')

    // Get next scheduled run
    const { data: nextSchedule } = await supabase
      .from('client_schedules')
      .select('next_run_at, client_profiles(name)')
      .eq('workspace_id', ws.id)
      .eq('enabled', true)
      .gte('next_run_at', new Date().toISOString())
      .order('next_run_at')
      .limit(1)
      .maybeSingle()

    // Build digest content
    const lines: string[] = [`Daily digest for ${ws.name || 'your workspace'}:`]
    if ((draftCount || 0) > 0) lines.push(`• ${draftCount} new draft${draftCount !== 1 ? 's' : ''} ready for review`)
    if ((kwCount || 0) > 0) lines.push(`• ${kwCount} keyword suggestion${kwCount !== 1 ? 's' : ''} pending approval`)
    if (nextSchedule) {
      const clientName = (nextSchedule as any).client_profiles?.name || 'a client'
      lines.push(`• Next scheduled run: ${clientName} at ${new Date((nextSchedule as any).next_run_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`)
    }

    if (lines.length <= 1) continue // Nothing to report

    const slackBlocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `Agencee Daily Digest — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.slice(1).join('\n') },
      },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: 'View dashboard' }, url: `${process.env.NEXT_PUBLIC_SITE_URL}` },
          ...(draftCount ? [{ type: 'button', text: { type: 'plain_text', text: `Review ${draftCount} draft${draftCount !== 1 ? 's' : ''}` }, url: `${process.env.NEXT_PUBLIC_SITE_URL}/outputs`, style: 'primary' as const }] : []),
        ],
      },
    ]

    await sendNotification({
      workspaceId: ws.id,
      type: 'digest',
      subject: `Agencee daily digest — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`,
      body: lines.join('\n'),
      slackBlocks,
    })
    sent++
  }

  return NextResponse.json({ sent })
}
