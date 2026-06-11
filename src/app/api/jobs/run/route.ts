import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forbiddenResponse, requireUserOrInternal } from '@/lib/server/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
export const maxDuration = 60

function splitSeedTerms(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(/[,;\n]/)
    .map(v => v.trim().toLowerCase())
    .filter(v => v.length > 2)
}

function cleanKeywordCandidate(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+[-|].*$/, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inferSeedIntent(keyword: string): 'informational' | 'commercial' | 'transactional' {
  if (/\b(price|cost|book|quote|buy|hire|near me)\b/i.test(keyword)) return 'transactional'
  if (/\b(best|compare|vs|review|service|services|company|companies)\b/i.test(keyword)) return 'commercial'
  if (/^(what|how|why|when|can|do|does)\b/i.test(keyword)) return 'informational'
  return 'commercial'
}

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

export async function POST(req: NextRequest) {
  const authResult = await requireUserOrInternal(req)
  if (!authResult.ok) return authResult.response

  try {
    const { job_id } = await req.json()
    if (!job_id) return NextResponse.json({ error: 'job_id required' }, { status: 400 })

    // Load job
    const { data: job, error: jobErr } = await supabase
      .from('scheduled_jobs')
      .select('*')
      .eq('id', job_id)
      .single()
    if (jobErr || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    if (authResult.auth.user) {
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('id')
        .eq('owner_id', authResult.auth.user.id)
        .maybeSingle()
      if (!workspace || workspace.id !== job.workspace_id) return forbiddenResponse()
    }

    if (job.last_run_status === 'running') {
      const startedAt = job.last_run_at ? new Date(job.last_run_at).getTime() : 0
      const stale = startedAt > 0 && startedAt < Date.now() - 10 * 60 * 1000
      if (!stale) return NextResponse.json({ error: 'Job already running' }, { status: 409 })
    }

    const forwardedAuth = req.headers.get('authorization') || (process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '')
    const internalHeaders = {
      'Content-Type': 'application/json',
      ...(forwardedAuth ? { Authorization: forwardedAuth } : {}),
    }

    // Create job_runs row
    const { data: runRow } = await supabase.from('job_runs').insert({
      job_id,
      workspace_id: job.workspace_id,
      client_id: job.client_id,
      status: 'running',
    }).select().single()

    // Mark job as running
    await supabase.from('scheduled_jobs').update({ last_run_status: 'running' }).eq('id', job_id)

    let summary = ''
    let success = true

    try {
      if (job.job_type === 'gsc_intelligence') {
        const results: string[] = []

        // 1. GSC sync
        const syncRes = await fetch(`${BASE_URL}/api/gsc/sync`, {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({ client_id: job.client_id }),
        })
        const syncData = await syncRes.json()
        if (syncData.synced) results.push(`GSC synced: 28d=${syncData.synced['28d'] ?? 0} rows, ${syncData.briefing_items ?? 0} briefing items`)
        else if (syncData.error) results.push(`GSC sync error: ${syncData.error}`)

        // 2. Decay detection
        const decayRes = await fetch(`${BASE_URL}/api/intelligence/decay`, {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({ client_id: job.client_id, workspace_id: job.workspace_id }),
        }).catch((err) => { console.error('[jobs/run] decay error:', err.message); return null })
        if (decayRes) {
          const decayData = await decayRes.json()
          results.push(`Decay: ${decayData.detected ?? 0} pages flagged`)
        }

        // 3. Opportunity scoring
        const scoreRes = await fetch(`${BASE_URL}/api/intelligence/score-keywords`, {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({ client_id: job.client_id }),
        }).catch((err) => { console.error('[jobs/run] score-keywords error:', err.message); return null })
        if (scoreRes) {
          const scoreData = await scoreRes.json()
          results.push(`Keywords scored: ${scoreData.scored ?? 0}`)
        }

        // 4. Refresh AI overview (cheap — cached 24h)
        await fetch(`${BASE_URL}/api/clients/${job.client_id}/overview`, {
          method: 'POST',
          headers: internalHeaders,
        }).catch((err) => console.error('[jobs/run] overview refresh error:', err.message))
        results.push('AI overview refreshed')

        summary = results.join('. ') || 'GSC intelligence run complete'

      } else if (job.job_type === 'keyword_research') {
        // Discover keywords from existing GSC data
        const { data: spRows } = await supabase
          .from('search_performance')
          .select('query,impressions,clicks,position')
          .eq('client_id', job.client_id)
          .neq('query', '__total__')
          .neq('query', '__page__')
          .neq('query', '__device__')
          .order('impressions', { ascending: false })
          .limit(500)

        if (spRows && spRows.length > 0 && job.workspace_id) {
          const { discoverKeywordsFromGSC } = await import('@/lib/gsc-keywords')
          const count = await discoverKeywordsFromGSC(
            supabase,
            job.client_id,
            job.workspace_id,
            spRows.map(r => ({ query: r.query, impressions: r.impressions, clicks: r.clicks, position: r.position }))
          )
          summary = `Discovered ${count} new keyword suggestions`
        } else {
          const [
            { data: clientProfile },
            { data: existingKw },
            { data: pendingSug },
            { data: rejectedSug },
            { data: compPages },
          ] = await Promise.all([
            supabase.from('client_profiles').select('name,industry,description,location_info,target_keywords,service_differentiators,workspace_id').eq('id', job.client_id).maybeSingle(),
            supabase.from('keyword_banks').select('keyword').eq('client_id', job.client_id),
            supabase.from('keyword_suggestions').select('keyword').eq('client_id', job.client_id).eq('status', 'pending'),
            supabase.from('keyword_suggestions').select('keyword').eq('client_id', job.client_id).eq('status', 'rejected'),
            supabase.from('competitor_pages').select('title,h1,meta_description,content_summary').eq('client_id', job.client_id).order('word_count', { ascending: false }).limit(30),
          ])

          const existingSet = new Set([
            ...(existingKw || []).map((k: any) => k.keyword.toLowerCase()),
            ...(pendingSug || []).map((k: any) => k.keyword.toLowerCase()),
            ...(rejectedSug || []).map((k: any) => k.keyword.toLowerCase()),
          ])
          const locations = splitSeedTerms(clientProfile?.location_info).slice(0, 8)
          const seedTerms = [
            ...splitSeedTerms(clientProfile?.target_keywords),
            ...splitSeedTerms(clientProfile?.service_differentiators),
            ...splitSeedTerms(clientProfile?.industry),
          ]
          const candidates = new Set<string>()

          for (const seed of seedTerms) {
            const cleaned = cleanKeywordCandidate(seed)
            if (cleaned && cleaned.length <= 80) candidates.add(cleaned)
            for (const location of locations) {
              const loc = cleanKeywordCandidate(location)
              if (cleaned && loc && !cleaned.includes(loc)) candidates.add(`${cleaned} ${loc}`.slice(0, 90))
            }
            if (cleaned && !/\bnear me\b/.test(cleaned)) candidates.add(`${cleaned} near me`)
          }

          for (const page of compPages || []) {
            const candidate = cleanKeywordCandidate(page.title || page.h1 || page.meta_description || '')
            if (
              candidate &&
              candidate.length >= 8 &&
              candidate.length <= 70 &&
              !/\b(home|contact|about|privacy|terms|blog)\b/.test(candidate)
            ) {
              candidates.add(candidate)
            }
          }

          const insertRows = [...candidates]
            .filter(keyword => !existingSet.has(keyword))
            .slice(0, 20)
            .map(keyword => ({
              workspace_id: job.workspace_id || clientProfile?.workspace_id || null,
              client_id: job.client_id,
              keyword,
              rationale: `Startup seed suggestion generated without GSC history from client profile, services, locations, and competitor content. Validate volume and SERP fit before approving.`,
              intent: inferSeedIntent(keyword),
              funnel_stage: inferSeedIntent(keyword) === 'informational' ? 'tofu' : 'bofu',
              cluster: clientProfile?.industry || 'startup seed',
              status: 'pending',
              suggested_by: 'ada',
            }))

          if (insertRows.length > 0) {
            const { error } = await supabase.from('keyword_suggestions').insert(insertRows)
            summary = error
              ? `No GSC data available. Startup keyword seed generation found ${insertRows.length} candidates, but saving suggestions failed: ${error.message}`
              : `No GSC data available yet. Generated ${insertRows.length} startup seed keyword suggestions from profile, locations, and competitor content.`
          } else {
            summary = 'No GSC data available yet, and there was not enough profile, location, service, or competitor context to generate startup seed keywords. Add target keywords/services, locations, or competitors first.'
          }
        }

      } else if (job.job_type === 'content') {
        // Load client's content_autonomy
        const { data: cp } = await supabase
          .from('client_profiles')
          .select('content_autonomy')
          .eq('id', job.client_id)
          .single()
        const autonomy = cp?.content_autonomy || 'manual'

        // Find a scheduled run via client_schedules
        const { data: clientSched } = await supabase
          .from('client_schedules')
          .select('*')
          .eq('client_id', job.client_id)
          .eq('enabled', true)
          .maybeSingle()

        if (clientSched) {
          const runRes = await fetch(`${BASE_URL}/api/schedule/run`, {
            method: 'POST',
            headers: internalHeaders,
            body: JSON.stringify({ schedule_id: clientSched.id }),
          })
          const runData = await runRes.json()
          summary = runData.ok ? `Content queued: "${runData.keyword}"` : (runData.message || 'Content run complete')

          // Handle autonomy
          if (autonomy === 'auto_approve' || autonomy === 'full_autopilot') {
            // Auto-approve the latest output for this client
            const { data: latestOutput } = await supabase
              .from('content_outputs')
              .select('id')
              .eq('client_id', job.client_id)
              .eq('approved', false)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()

            if (latestOutput) {
              await supabase.from('content_outputs').update({ approved: true }).eq('id', latestOutput.id)
              summary += ' · Auto-approved'

              if (autonomy === 'full_autopilot') {
                await fetch(`${BASE_URL}/api/vercel/promote`, {
                  method: 'POST',
                  headers: internalHeaders,
                  body: JSON.stringify({ output_id: latestOutput.id }),
                }).catch((err) => console.error('[jobs/run] vercel promote error:', err.message))
                summary += ' · Submitted for production promotion'
              }
            }
          }
        } else {
          summary = 'No content schedule configured for this client'
        }

      } else if (job.job_type === 'site_audit') {
        const { data: clientRow } = await supabase.from('client_profiles').select('website').eq('id', job.client_id).single()
        if (clientRow?.website) {
          const crawlRes = await fetch(`${BASE_URL}/api/crawl`, {
            method: 'POST',
            headers: internalHeaders,
            body: JSON.stringify({ client_id: job.client_id, website: clientRow.website }),
          })
          const crawlData = await crawlRes.json()
          summary = crawlData.error ? `Crawl failed: ${crawlData.error}` : `Site audit complete: ${crawlData.pages_crawled ?? 0} pages crawled`
        } else {
          summary = 'No website URL configured for this client'
        }
      } else {
        throw new Error(`Unknown job type: ${job.job_type}`)
      }
    } catch (runErr: any) {
      success = false
      summary = `Error: ${runErr.message}`
    }

    const now = new Date().toISOString()
    const next_run_at = calculateNextRun(job.cadence, job.run_day, job.run_hour || 8)

    // Update job_runs
    if (runRow) {
      await supabase.from('job_runs').update({
        completed_at: now,
        status: success ? 'success' : 'failed',
        summary,
      }).eq('id', runRow.id)
    }

    // Update scheduled_jobs
    await supabase.from('scheduled_jobs').update({
      last_run_at: now,
      last_run_summary: summary,
      last_run_status: success ? 'success' : 'failed',
      next_run_at: next_run_at.toISOString(),
    }).eq('id', job_id)

    return NextResponse.json({ success, summary })
  } catch (e: any) {
    console.error('[jobs/run] error:', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
