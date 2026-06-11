import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendNotification } from '@/lib/notifications'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// Process the next due schedule — called by cron or manually
export async function POST(req: NextRequest) {
  const { schedule_id } = await req.json().catch(() => ({}))

  // Load schedule (and optionally limit to a specific one)
  let query = supabase
    .from('client_schedules')
    .select('*, client_profiles(*), agents(*)')
    .eq('enabled', true)

  if (schedule_id) {
    query = query.eq('id', schedule_id) as any
  } else {
    // Find any schedule that is due now
    query = query.lte('next_run_at', new Date().toISOString()).limit(1) as any
  }

  const { data: schedules } = await query
  if (!schedules || schedules.length === 0) {
    return NextResponse.json({ ok: true, message: 'No schedules due' })
  }

  const schedule = schedules[0]
  const client = (schedule as any).client_profiles
  const agent = (schedule as any).agents
  const workspaceId = (schedule as any).workspace_id

  if (!client || !agent) {
    return NextResponse.json({ error: 'Schedule references missing client or agent' }, { status: 400 })
  }

  // Load the keyword bank and pick a priority keyword that hasn't been written
  const { data: keywords } = await supabase
    .from('keyword_banks')
    .select('*')
    .eq('client_id', client.id)
    .is('content_targeting_this', null)
    .order('priority')
    .limit(1)

  const keyword = keywords?.[0]
  if (!keyword) {
    return NextResponse.json({ ok: true, message: 'No untargeted keywords left for this client' })
  }

  // Insert a queue item
  const contentType = schedule.content_types?.[0] || 'blog_post'
  const { data: queueItem, error } = await supabase
    .from('content_queue')
    .insert({
      workspace_id: workspaceId || null,
      client_id: client.id,
      agent_type: 'ada',
      content_type: contentType,
      primary_keyword: keyword.keyword,
      supporting_keywords: [],
      word_count: schedule.target_word_count || 1500,
      scheduled_for: new Date().toISOString(),
      status: 'queued',
      notes: `Auto-scheduled by ${agent.name}. Cadence: ${schedule.cadence}.${schedule.notes ? ' ' + schedule.notes : ''}`,
    })
    .select()
    .single()

  if (error) {
    sendNotification({
      workspaceId: workspaceId || '',
      type: 'schedule_failed',
      subject: `Scheduled run failed — ${client.name}`,
      body: `Ada's scheduled run for ${client.name} failed: ${error.message}`,
    }).catch((err) => console.error('[schedule/run] Notification failed:', err.message))
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Update schedule: set last_run_at and compute next_run_at
  const now = new Date()
  const next = new Date(now)
  switch (schedule.cadence) {
    case 'daily': next.setDate(next.getDate() + 1); break
    case 'weekly': next.setDate(next.getDate() + 7); break
    case 'biweekly': next.setDate(next.getDate() + 14); break
    case 'monthly': next.setMonth(next.getMonth() + 1); break
  }

  await supabase.from('client_schedules').update({
    last_run_at: now.toISOString(),
    next_run_at: next.toISOString(),
    updated_at: now.toISOString(),
  }).eq('id', schedule.id)

  // Log activity
  await supabase.from('agent_activity').insert({
    workspace_id: workspaceId || null,
    agent_id: agent.id,
    client_id: client.id,
    action: 'scheduled_run',
    detail: `Queued ${contentType} for keyword "${keyword.keyword}"`,
    tokens_used: 0,
  })

  // Fire-and-forget notification
  sendNotification({
    workspaceId: workspaceId || '',
    type: 'schedule_complete',
    subject: `Scheduled run complete — ${client.name}`,
    body: `Ada queued a ${contentType} post for "${keyword.keyword}" (${client.name}). View in queue: ${process.env.NEXT_PUBLIC_SITE_URL}/queue`,
  }).catch((err) => console.error('[schedule/run] Notification failed:', err.message))

  return NextResponse.json({
    ok: true,
    queue_item_id: queueItem.id,
    keyword: keyword.keyword,
    next_run_at: next.toISOString(),
  })
}
