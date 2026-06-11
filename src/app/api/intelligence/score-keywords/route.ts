import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

function calculateOpportunityScore(kw: any, gscPosition?: number): number {
  let score = 50

  // GSC position adjustments
  if (gscPosition !== undefined && gscPosition !== null) {
    if (gscPosition >= 1 && gscPosition <= 3) score -= 20
    else if (gscPosition >= 4 && gscPosition <= 10) score += 10
    else if (gscPosition >= 11 && gscPosition <= 20) score += 25
    else if (gscPosition >= 21 && gscPosition <= 50) score += 15
    else score += 5
  } else {
    // Not ranking — high opportunity
    score += 15
  }

  // Volume adjustments
  const vol = kw.monthly_volume || 0
  if (vol >= 10000) score += 20
  else if (vol >= 1000) score += 15
  else if (vol >= 500) score += 10
  else if (vol >= 100) score += 5
  else if (vol < 50) score -= 10

  // KD adjustments
  const kd = kw.difficulty || 50
  if (kd <= 20) score += 15
  else if (kd <= 40) score += 8
  else if (kd >= 70) score -= 15
  else if (kd >= 60) score -= 8

  // Content already targeting: -25
  if (kw.content_targeting_this) score -= 25

  // Priority field bonus
  const priority = kw.priority || 5
  if (priority <= 2) score += 10
  else if (priority <= 4) score += 5

  return Math.max(0, Math.min(100, Math.round(score)))
}

export async function POST(_req: NextRequest) {
  // Load all keyword_banks
  const { data: keywords } = await supabase
    .from('keyword_banks')
    .select('id, keyword, monthly_volume, difficulty, priority, content_targeting_this, client_id')

  if (!keywords || keywords.length === 0) return NextResponse.json({ updated: 0 })

  // Load latest GSC positions per keyword
  const { data: gscRows } = await supabase
    .from('search_performance')
    .select('query, position, client_id')
    .order('impressions', { ascending: false })

  const gscMap: Record<string, Record<string, number>> = {}
  for (const r of gscRows || []) {
    if (!gscMap[r.client_id]) gscMap[r.client_id] = {}
    if (!gscMap[r.client_id][r.query.toLowerCase()]) {
      gscMap[r.client_id][r.query.toLowerCase()] = r.position
    }
  }

  let updated = 0
  for (const kw of keywords) {
    const gscPosition = gscMap[kw.client_id]?.[kw.keyword.toLowerCase()]
    const score = calculateOpportunityScore(kw, gscPosition)
    await supabase.from('keyword_banks').update({ opportunity_score: score }).eq('id', kw.id)
    updated++
  }

  return NextResponse.json({ updated })
}
