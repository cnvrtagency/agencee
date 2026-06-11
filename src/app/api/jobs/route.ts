import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

// GET — list scheduled_jobs for a client
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('scheduled_jobs')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data || [] })
}

// POST — create a new scheduled_job
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { client_id, workspace_id, agent_id, name, job_type, description, cadence, run_day, run_hour = 8 } = body

    if (!client_id || !name || !job_type || !cadence) {
      return NextResponse.json({ error: 'client_id, name, job_type, cadence are required' }, { status: 400 })
    }

    const next_run_at = calculateNextRun(cadence, run_day || null, run_hour)

    const { data, error } = await supabase.from('scheduled_jobs').insert({
      client_id,
      workspace_id: workspace_id || null,
      agent_id: agent_id || null,
      name,
      job_type,
      description: description || null,
      enabled: true,
      cadence,
      run_day: run_day || null,
      run_hour,
      next_run_at: next_run_at.toISOString(),
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ job: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
