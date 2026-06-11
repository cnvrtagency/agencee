import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forbiddenResponse, requireUser } from '@/lib/server/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

function calculateNextRun(cadence: string, runDay: string | null, runHour: number): Date {
  const now = new Date()
  const next = new Date()
  next.setUTCHours(runHour, 0, 0, 0)
  if (cadence === 'daily') {
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  } else if (cadence === 'weekly' || cadence === 'biweekly') {
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    const target = days.indexOf((runDay || 'monday').toLowerCase())
    let diff = target - now.getUTCDay()
    if (diff <= 0) diff += 7
    if (cadence === 'biweekly') diff += 7
    next.setUTCDate(now.getUTCDate() + diff)
    next.setUTCHours(runHour, 0, 0, 0)
  } else if (cadence === 'monthly') {
    next.setUTCMonth(next.getUTCMonth() + 1, 1)
    next.setUTCHours(runHour, 0, 0, 0)
  }
  return next
}

async function validateJobOwnership(userId: string, jobId: string): Promise<boolean> {
  const { data: job } = await supabase.from('scheduled_jobs').select('workspace_id').eq('id', jobId).single()
  if (!job) return false
  const { data: workspace } = await supabase.from('workspaces').select('id').eq('owner_id', userId).single()
  return !!(workspace && workspace.id === job.workspace_id)
}

// PATCH — update a scheduled_job
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  try {
    const { id } = await params

    if (!(await validateJobOwnership(authResult.auth.user.id, id))) return forbiddenResponse()

    const body = await req.json()
    const updates: any = {}

    if (body.name !== undefined) updates.name = body.name
    if (body.job_type !== undefined) updates.job_type = body.job_type
    if (body.description !== undefined) updates.description = body.description
    if (body.enabled !== undefined) updates.enabled = body.enabled
    if (body.cadence !== undefined) updates.cadence = body.cadence
    if (body.run_day !== undefined) updates.run_day = body.run_day
    if (body.run_hour !== undefined) updates.run_hour = body.run_hour

    // Recalculate next_run_at if schedule params changed
    if (body.cadence || body.run_day !== undefined || body.run_hour !== undefined) {
      const { data: existing } = await supabase.from('scheduled_jobs').select('cadence,run_day,run_hour').eq('id', id).single()
      if (existing) {
        const cadence = body.cadence || existing.cadence
        const run_day = body.run_day !== undefined ? body.run_day : existing.run_day
        const run_hour = body.run_hour !== undefined ? body.run_hour : existing.run_hour
        updates.next_run_at = calculateNextRun(cadence, run_day, run_hour).toISOString()
      }
    }

    const { data, error } = await supabase.from('scheduled_jobs').update(updates).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ job: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const { id } = await params

  if (!(await validateJobOwnership(authResult.auth.user.id, id))) return forbiddenResponse()

  const { error } = await supabase.from('scheduled_jobs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
