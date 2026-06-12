// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function discoverKeywordsFromGSC(
  supabase: any,
  clientId: string,
  workspaceId: string,
  rows: Array<{ keys?: string[]; query?: string; impressions: number; clicks: number; position: number }>,
  brandTerms: string[] = []
): Promise<number> {
  // Load existing keywords, pending suggestions, and rejected suggestions
  const [{ data: existingKw }, { data: pendingSug }, { data: rejectedSug }] = await Promise.all([
    supabase.from('keyword_banks').select('keyword').eq('client_id', clientId),
    supabase.from('keyword_suggestions').select('keyword').eq('client_id', clientId).eq('status', 'pending'),
    supabase.from('keyword_suggestions').select('keyword').eq('client_id', clientId).eq('status', 'rejected'),
  ])

  const existingSet = new Set([
    ...(existingKw || []).map((k: any) => k.keyword.toLowerCase()),
    ...(pendingSug || []).map((k: any) => k.keyword.toLowerCase()),
    ...(rejectedSug || []).map((k: any) => k.keyword.toLowerCase()),
  ])

  // Normalise rows — sync route uses r.keys[0], analyse_gsc uses r.query
  const normalised = rows.map(r => ({
    query: r.keys ? r.keys[0] : (r.query || ''),
    impressions: r.impressions,
    clicks: r.clicks,
    position: r.position,
  }))

  const candidates = normalised
    .filter(r =>
      r.impressions > 5 &&
      r.query &&
      r.query !== '__total__' &&
      !existingSet.has(r.query.toLowerCase()) &&
      !brandTerms.some(b => r.query.toLowerCase().includes(b.toLowerCase()))
    )
    .sort((a, b) => b.impressions - a.impressions)

  let count = 0
  for (const c of candidates) {
    const intent = c.position <= 10 ? 'commercial' :
      c.query.includes('what') || c.query.includes('how') ? 'informational' : 'commercial'
    const opportunity = c.position <= 10
      ? `Average position ${Math.round(c.position * 10) / 10} — close enough to investigate as a near-miss opportunity`
      : `${c.impressions} impressions/month — untapped keyword with existing search demand`

    // Try with metadata first, fall back without if column doesn't exist
    const rationale = `Discovered from GSC data. ${opportunity}. Average position ${Math.round(c.position * 10) / 10}, ${c.impressions} impressions, ${c.clicks} clicks.`

    // Try full insert first (with source + metadata)
    const { error: e1 } = await supabase.from('keyword_suggestions').insert({
      workspace_id: workspaceId,
      client_id: clientId,
      keyword: c.query,
      rationale,
      source: 'gsc_discovery',
      status: 'pending',
      suggested_by: 'ada',
      metadata: { position: c.position, impressions: c.impressions, clicks: c.clicks },
    })

    if (!e1) { count++; continue }

    // source or metadata column missing — try without metadata
    const { error: e2 } = await supabase.from('keyword_suggestions').insert({
      workspace_id: workspaceId,
      client_id: clientId,
      keyword: c.query,
      rationale,
      source: 'gsc_discovery',
      status: 'pending',
      suggested_by: 'ada',
    })

    if (!e2) { count++; continue }

    // source column missing — try without it
    const { error: e3 } = await supabase.from('keyword_suggestions').insert({
      workspace_id: workspaceId,
      client_id: clientId,
      keyword: c.query,
      rationale,
      status: 'pending',
      suggested_by: 'ada',
    })

    if (!e3) count++
  }
  return count
}
