import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

interface SendNotificationParams {
  workspaceId: string
  type: string
  subject: string
  body: string
  slackBlocks?: any[]
  actionUrl?: string
}

export async function sendNotification({ workspaceId, type, subject, body, slackBlocks, actionUrl }: SendNotificationParams) {
  if (!workspaceId) return

  // Get notification preferences
  const { data: prefs } = await supabaseAdmin
    .from('notification_preferences')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  // Get user email via workspace → owner_id → auth.users
  const { data: workspace } = await supabaseAdmin
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .single()

  let userEmail: string | null = null
  if (workspace?.owner_id) {
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(workspace.owner_id)
    userEmail = user?.email || null
  }

  const emailEnabled = prefs?.email_enabled !== false
  const slackWebhook = prefs?.slack_webhook_url || null

  // Check type-specific preferences
  if (type === 'output_ready' && prefs?.notify_output_ready === false) return
  if (type === 'ranking_change' && prefs?.notify_ranking_changes === false) return
  if (type === 'schedule_complete' && prefs?.notify_schedule_complete === false) return
  if (type === 'schedule_failed' && prefs?.notify_schedule_failed === false) return

  const sent: string[] = []

  // Send email via Resend
  if (emailEnabled && userEmail && process.env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'notifications@agencee.app',
          to: userEmail,
          subject,
          text: body,
          html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px"><h2 style="color:#1a1a2e;margin-bottom:12px">${subject}</h2><p style="color:#555;line-height:1.6">${body.replace(/\n/g, '<br>')}</p>${actionUrl ? `<p><a href="${process.env.NEXT_PUBLIC_SITE_URL}${actionUrl}" style="display:inline-block;background:#4f7fff;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;margin-top:8px">Review content →</a></p>` : ''}<hr style="border:none;border-top:1px solid #eee;margin:20px 0"><p style="color:#999;font-size:12px">Agencee · <a href="${process.env.NEXT_PUBLIC_SITE_URL}" style="color:#4f7fff">View dashboard</a></p></div>`,
        }),
      })
      sent.push('email')
    } catch (err: any) {
      console.error('[notifications] Email send failed:', err.message)
    }
  }

  // Send Slack
  if (slackWebhook) {
    try {
      const slackBody = slackBlocks
        ? { blocks: slackBlocks }
        : { text: `*${subject}*\n${body}` }
      await fetch(slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackBody),
      })
      sent.push('slack')
    } catch (err: any) {
      console.error('[notifications] Slack send failed:', err.message)
    }
  }

  // Log to notification_log
  try {
    await supabaseAdmin.from('notification_log').insert({
      workspace_id: workspaceId,
      type,
      subject,
      body,
      channels: sent,
      sent_at: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('[notifications] Log insert failed:', err.message)
  }
}
