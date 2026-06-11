import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const maxDuration = 60

// Called by Vercel cron — triggers any schedules that are due
export async function GET(req: NextRequest) {
  // Verify cron secret — fail closed: reject if CRON_SECRET not set or secret doesn't match.
  // Accepts three forms:
  //   1. Vercel's own x-vercel-cron-signature header (automated cron calls)
  //   2. Authorization: Bearer <CRON_SECRET> (manual curl tests, repair routes)
  //   3. x-cron-secret: <CRON_SECRET> (legacy)
  const cronSecret = process.env.CRON_SECRET
  const vercelSignature = req.headers.get('x-vercel-cron-signature')
  const authHeader = req.headers.get('authorization')
  const legacySecret = req.headers.get('x-cron-secret')

  const authorised =
    !!vercelSignature ||
    (!!cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (!!cronSecret && legacySecret === cronSecret)

  if (!authorised) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not set. Cron entry can authenticate, but internal subrequests cannot run safely.' }, { status: 500 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const internalHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cronSecret}`,
  }

  // Find due schedules
  const { data: schedules } = await supabase
    .from('client_schedules')
    .select('id, client_id, cadence')
    .eq('enabled', true)
    .lte('next_run_at', new Date().toISOString())

  // Trigger each due schedule
  const results = await Promise.allSettled(
    (schedules ?? []).map(s =>
      fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/schedule/run`, {
        method: 'POST',
        headers: internalHeaders,
        body: JSON.stringify({ schedule_id: s.id }),
      }).then(r => r.json())
    )
  )

  const succeeded = results.filter(r => r.status === 'fulfilled').length

  // Sync GSC connections not synced in last 23h
  const { data: connections } = await supabase
    .from('google_connections')
    .select('id, client_id')
    .in('status', ['active', 'connected'])
    .lt('last_synced_at', new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString())

  for (const conn of connections ?? []) {
    await fetch(`${baseUrl}/api/gsc/sync`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ connection_id: conn.id }),
    }).catch((err) => console.error('[schedule/check] Sub-request failed:', err.message))
  }

  // Monthly auto-generate reports on the 1st / weekly SEO digest on Mondays
  const now = new Date()

  // Weekly SEO knowledge digest — runs on Mondays
  if (now.getDay() === 1) {
    await fetch(`${baseUrl}/api/intelligence/knowledge-digest`, {
      method: 'POST',
      headers: internalHeaders,
    }).catch((err) => console.error('[schedule/check] Knowledge digest failed:', err.message))
  }

  if (now.getDate() === 1) {
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]
    const { data: clientsWithOutputs } = await supabase
      .from('content_outputs')
      .select('client_id')
      .gte('created_at', prevMonthStart)
      .lte('created_at', prevMonthEnd + 'T23:59:59Z')
    const uniqueClientIds = [...new Set((clientsWithOutputs || []).map((r: any) => r.client_id))]
    for (const cid of uniqueClientIds) {
      await fetch(`${baseUrl}/api/reports/generate`, {
        method: 'POST',
        headers: internalHeaders,
        body: JSON.stringify({ client_id: cid, period_start: prevMonthStart, period_end: prevMonthEnd }),
      }).catch((err) => console.error('[schedule/check] Sub-request failed:', err.message))
    }
  }

  // Trigger due scheduled_jobs
  const { data: dueJobs } = await supabase
    .from('scheduled_jobs')
    .select('*')
    .eq('enabled', true)
    .lte('next_run_at', new Date().toISOString())
  const staleCutoff = Date.now() - 10 * 60 * 1000
  const runnableJobs = (dueJobs ?? []).filter((job: any) =>
    job.last_run_status !== 'running' ||
    !job.last_run_at ||
    new Date(job.last_run_at).getTime() < staleCutoff
  )

  await Promise.allSettled(runnableJobs.map((job: any) =>
    fetch(`${baseUrl}/api/jobs/run`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ job_id: job.id }),
    }).catch((err) => console.error('[schedule/check] Job run failed:', err.message))
  ))

  // Trigger due agent automations
  const { data: dueAutomations } = await supabase
    .from('agent_automations')
    .select('id, agent_id, last_run_at, last_run_status')
    .eq('enabled', true)
    .lte('next_run_at', new Date().toISOString())
  const runnableAutomations = (dueAutomations ?? []).filter((automation: any) =>
    automation.last_run_status !== 'running' ||
    !automation.last_run_at ||
    new Date(automation.last_run_at).getTime() < staleCutoff
  )

  await Promise.allSettled(runnableAutomations.map((automation: any) =>
    fetch(`${baseUrl}/api/intelligence/run-automation`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ automation_id: automation.id, agent_id: automation.agent_id }),
    }).then(async (r) => {
      const status = r.ok ? 'success' : 'error'
      const data = await r.json().catch(() => ({}))
      await supabase.from('agent_automations').update({
        last_run_at: new Date().toISOString(),
        last_run_status: status,
        last_run_summary: (data.summary || data.error || '').slice(0, 500),
      }).eq('id', automation.id)
    }).catch((err) => console.error('[schedule/check] Automation failed:', err.message))
  ))

  // Send daily digest
  await fetch(`${baseUrl}/api/notifications/digest`, {
    method: 'POST',
    headers: internalHeaders,
  }).catch((err) => console.error('[schedule/check] Sub-request failed:', err.message))

  return NextResponse.json({
    triggered: (schedules ?? []).length,
    succeeded,
    jobs_triggered: runnableJobs.length,
    automations_triggered: runnableAutomations.length,
  })
}
