'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const STATUS_COLOR: Record<string, string> = {
  suggested: 'var(--text-2)',
  planned: 'var(--text-2)',
  approved: 'var(--accent)',
  scheduled: 'var(--amber)',
  in_progress: 'var(--amber)',
  written: 'var(--purple)',
  published: 'var(--green)',
  cancelled: 'var(--red)',
}

const STATUS_BG: Record<string, string> = {
  suggested: 'var(--surface-2)',
  planned: 'var(--surface-2)',
  approved: 'var(--accent-bg)',
  scheduled: 'var(--amber-bg)',
  in_progress: 'var(--amber-bg)',
  written: 'rgba(139,92,246,0.08)',
  published: 'var(--green-bg)',
  cancelled: 'var(--red-bg)',
}

const S: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 20 },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '11px 16px', borderBottom: '1px solid var(--border)' },
  td: { padding: '11px 16px', fontSize: 13, verticalAlign: 'top' as const },
}

function pill(active: boolean, color = 'var(--brand)'): React.CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 'var(--radius-md)', fontSize: 12, cursor: 'pointer', border: 'none',
    background: active ? color : 'var(--surface-2)',
    color: active ? '#fff' : 'var(--text-2)',
    fontWeight: active ? 600 : 400,
  }
}

type CalEntry = {
  id: string
  client_id: string
  title: string
  primary_keyword: string | null
  content_type: string | null
  scheduled_date: string | null
  suggested_publish_date?: string | null
  status: string
  notes: string | null
  rationale?: string | null
  priority?: number | null
  output_id?: string | null
  client_profiles?: { name: string } | null
}

function StatusPill({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius)',
      color: STATUS_COLOR[status] || 'var(--text-2)',
      background: STATUS_BG[status] || 'var(--surface-2)',
      textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
    }}>
      {status}
    </span>
  )
}

// Minimal tool handler for the calendar planner — only needs planning tools
async function handleCalendarTool(
  toolName: string,
  toolInput: any,
  clients: { id: string; name: string }[],
  agentId: string,
  workspaceId: string | null,
): Promise<string> {
  const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))

  if (toolName === 'get_keywords') {
    if (!client) return `Could not find client matching "${toolInput.client_name}".`
    const { data } = await supabase.from('keyword_banks')
      .select('keyword,intent,funnel_stage,monthly_volume,difficulty,current_position,content_targeting_this,cluster,priority,opportunity_score')
      .eq('client_id', client.id)
      .order('opportunity_score', { ascending: false, nullsFirst: false })
      .limit(200)
    if (!data || data.length === 0) return `No keywords in bank for ${client.name}.`
    let filtered = data
    if (toolInput.filter === 'untargeted') filtered = data.filter((k: any) => !k.content_targeting_this)
    return `Keyword bank for ${client.name} — ${filtered.length} keywords:\n` + filtered.map((k: any) =>
      `• "${k.keyword}" | ${k.intent || '?'} | ${k.funnel_stage || '?'} | vol: ${k.monthly_volume || '?'} | KD: ${k.difficulty || '?'} | pos: ${k.current_position || 'not ranking'} | targeting: ${k.content_targeting_this || 'nothing yet'}`
    ).join('\n')
  }

  if (toolName === 'search_history') {
    if (!client) return `Could not find client matching "${toolInput.client_name}".`
    const { data } = await supabase.from('content_history')
      .select('title,url,primary_keyword,summary,published_at')
      .eq('client_id', client.id)
      .order('published_at', { ascending: false })
    if (!data || data.length === 0) return `No content history for ${client.name}.`
    const query = (toolInput.query || '').toLowerCase()
    const list = query ? data.filter((h: any) => (h.title || '').toLowerCase().includes(query) || (h.primary_keyword || '').toLowerCase().includes(query)) : data
    return `Content history for ${client.name} (${data.length} pieces):\n` + list.map((h: any) =>
      `• "${h.title}" [${h.primary_keyword || 'no keyword'}] — ${h.published_at ? new Date(h.published_at).toLocaleDateString('en-GB') : 'unknown'}`
    ).join('\n')
  }

  if (toolName === 'analyse_gsc') {
    if (!client) return `Could not find client matching "${toolInput.client_name}".`
    const { data: rows } = await supabase.from('search_performance')
      .select('query,position,impressions,clicks,ctr')
      .eq('client_id', client.id)
      .not('query', 'in', '("__total__","__page__","__device__")')
      .order('impressions', { ascending: false })
      .limit(50)
    if (!rows || rows.length === 0) return `No GSC data for ${client.name}.`
    const nearMiss = rows.filter((r: any) => r.position >= 5 && r.position <= 15 && r.impressions > 50).slice(0, 10)
    return `GSC near-miss keywords for ${client.name}:\n` + nearMiss.map((r: any) =>
      `• "${r.query}" pos ${Math.round(r.position)} (${r.impressions} impressions)`
    ).join('\n')
  }

  if (toolName === 'create_content_plan') {
    if (!client) return `Could not find client matching "${toolInput.client_name}".`
    const entries: any[] = toolInput.entries || []
    if (!entries.length) return 'No entries provided.'
    const { data, error } = await supabase.from('content_calendar').insert(
      entries.map(e => ({
        client_id: client.id,
        workspace_id: workspaceId,
        title: e.title,
        primary_keyword: e.primary_keyword || null,
        content_type: e.content_type || 'blog_post',
        scheduled_date: e.scheduled_date || null,
        status: 'planned',
        notes: e.notes || null,
      }))
    ).select()
    if (error) return `Failed to save plan: ${error.message}`
    return `Content plan created: ${entries.length} entries added.`
  }

  return `Tool ${toolName} not handled in calendar context.`
}

export default function AgentCalendarPage() {
  const { id: agentId } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<{ name: string; slug: string } | null>(null)
  const [entries, setEntries] = useState<CalEntry[]>([])
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [clientFilter, setClientFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)

  // Generator state
  const [genClient, setGenClient] = useState('')
  const [genTimeframe, setGenTimeframe] = useState(4)
  const [genPpw, setGenPpw] = useState(3)
  const [genFocus, setGenFocus] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genLog, setGenLog] = useState<string[]>([])

  useEffect(() => {
    supabase.from('agents').select('name,slug').eq('id', agentId).single().then(({ data }) => setAgent(data))
    supabase.from('client_profiles').select('id,name').order('name').then(({ data }) => {
      setClients(data || [])
      if (data && data.length > 0) setGenClient(data[0].id)
    })
    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user) {
        const { data: ws } = await supabase.from('workspaces').select('id').eq('owner_id', data.user.id).maybeSingle()
        if (ws) setWorkspaceId(ws.id)
      }
    })
  }, [agentId])

  useEffect(() => { load() }, [clientFilter, statusFilter])

  async function load() {
    let q = supabase.from('content_calendar').select('*, client_profiles(name)').order('scheduled_date', { ascending: true, nullsFirst: false })
    if (clientFilter !== 'all') q = q.eq('client_id', clientFilter) as any
    if (statusFilter !== 'all') q = q.eq('status', statusFilter) as any
    const { data } = await q
    setEntries(data || [])
  }

  async function generatePlan() {
    const client = clients.find(c => c.id === genClient)
    if (!client || generating) return
    setGenerating(true)
    setGenLog([])

    const addLog = (msg: string) => setGenLog(prev => [...prev, msg])

    const today = new Date().toISOString().split('T')[0]
    const focus = genFocus.trim() || 'highest opportunity keywords based on GSC data and keyword bank'
    const userMessage = `You are creating a content plan for ${client.name}.\nTimeframe: ${genTimeframe} weeks starting ${today}.\nTarget: ${genPpw} posts per week.\nFocus: ${focus}.\nPull the keyword bank and search history first, then call create_content_plan with the full plan (${genTimeframe * genPpw} entries). Sequence by fastest ranking wins first.`

    const { data: agentData } = await supabase.from('agents').select('name,role,instructions').eq('id', agentId).single()
    const systemPrompt = agentData ? `You are ${agentData.name}, ${agentData.role}. ${agentData.instructions || ''}` : 'You are an SEO content strategist.'

    const CALENDAR_TOOLS = [
      { name: 'get_keywords', description: 'Fetch the keyword bank for a client.', input_schema: { type: 'object', properties: { client_name: { type: 'string' }, filter: { type: 'string', enum: ['all', 'untargeted'] } }, required: ['client_name'] } },
      { name: 'search_history', description: 'Search content history to avoid repeating angles.', input_schema: { type: 'object', properties: { client_name: { type: 'string' }, query: { type: 'string' } }, required: ['client_name'] } },
      { name: 'analyse_gsc', description: 'Get GSC near-miss keywords for a client.', input_schema: { type: 'object', properties: { client_name: { type: 'string' }, period: { type: 'string', enum: ['7d', '28d', '90d'] } }, required: ['client_name'] } },
      {
        name: 'create_content_plan',
        description: 'Create a content calendar plan for a client.',
        input_schema: {
          type: 'object',
          properties: {
            client_name: { type: 'string' },
            entries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  primary_keyword: { type: 'string' },
                  content_type: { type: 'string', enum: ['blog_post', 'pillar_page', 'category_page', 'local_seo'] },
                  scheduled_date: { type: 'string' },
                  notes: { type: 'string' },
                },
                required: ['title'],
              },
            },
          },
          required: ['client_name', 'entries'],
        },
      },
    ]

    try {
      const apiMessages: any[] = [{ role: 'user', content: userMessage }]
      let loopCount = 0

      while (loopCount < 8) {
        loopCount++
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 8000,
            system: systemPrompt,
            tools: CALENDAR_TOOLS,
            messages: apiMessages,
          }),
        })
        const data = await res.json()
        if (data.error || !data.content) { addLog(`Error: ${data.error?.message || 'Unknown error'}`); break }

        if (data.stop_reason === 'tool_use') {
          apiMessages.push({ role: 'assistant', content: data.content })
          const toolBlocks = data.content.filter((b: any) => b.type === 'tool_use')
          addLog(`Running ${toolBlocks.length} tool${toolBlocks.length > 1 ? 's' : ''}: ${toolBlocks.map((b: any) => b.name).join(', ')}`)
          const results = await Promise.all(toolBlocks.map(async (block: any) => {
            const result = await handleCalendarTool(block.name, block.input, clients, agentId, workspaceId)
            if (block.name === 'create_content_plan') addLog(`Plan created successfully.`)
            return { type: 'tool_result', tool_use_id: block.id, content: result }
          }))
          apiMessages.push({ role: 'user', content: results })
        } else {
          const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()
          if (text) addLog(text.slice(0, 200))
          break
        }
      }
    } catch (e: any) {
      addLog(`Error: ${e.message}`)
    }

    setGenerating(false)
    load()
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from('content_calendar').update({ status }).eq('id', id)
    setEntries(prev => prev.map(e => e.id === id ? { ...e, status } : e))
  }

  async function queueEntry(entry: CalEntry) {
    await supabase.from('content_queue').insert({
      client_id: entry.client_id,
      agent_type: 'seo',
      content_type: entry.content_type || 'blog_post',
      primary_keyword: entry.primary_keyword || entry.title,
      word_count: 1500,
      scheduled_for: entry.scheduled_date || new Date().toISOString(),
      status: 'queued',
      calendar_id: entry.id,
    })
    await supabase.from('content_calendar').update({ status: 'in_progress' }).eq('id', entry.id)
    load()
  }

  async function bulkApprove() {
    for (const id of checked) { await updateStatus(id, 'approved') }
    setChecked(new Set())
  }

  async function bulkSchedule() {
    for (const id of checked) {
      const e = entries.find(x => x.id === id)
      if (e) await queueEntry(e)
    }
    setChecked(new Set())
  }

  function toggleCheck(id: string) {
    setChecked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function buildWriteNowUrl(entry: CalEntry) {
    const msg = `Write a complete, publish-ready blog post for ${(entry.client_profiles as any)?.name || 'the client'} targeting the keyword "${entry.primary_keyword || entry.title}". ${entry.notes ? `Angle: ${entry.notes}` : ''} Check search_history first to avoid repeating angles, then write the full post with images and save it with write_content.`
    return `/agents/${agentId}?draft=${encodeURIComponent(msg)}&send=1`
  }

  // Group by week
  const byWeek: Record<string, CalEntry[]> = {}
  entries.forEach(e => {
    const d = e.scheduled_date || e.suggested_publish_date
    let weekLabel = 'Unscheduled'
    if (d) {
      const date = new Date(d)
      const day = date.getDay()
      const diff = date.getDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(date)
      monday.setDate(diff)
      weekLabel = `Week of ${monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
    }
    if (!byWeek[weekLabel]) byWeek[weekLabel] = []
    byWeek[weekLabel].push(e)
  })

  const counts = {
    suggested: entries.filter(e => e.status === 'suggested' || e.status === 'planned').length,
    approved: entries.filter(e => e.status === 'approved').length,
    scheduled: entries.filter(e => e.status === 'scheduled' || e.status === 'in_progress').length,
    written: entries.filter(e => e.status === 'written').length,
    published: entries.filter(e => e.status === 'published').length,
  }

  const statusFilters = ['all', 'planned', 'approved', 'scheduled', 'written', 'published']

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{agent?.name ?? '...'}</div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.5px' }}>Content Calendar</h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>Plan and track content production.</p>
      </div>

      {/* Content Plan Generator */}
      <div style={S.panel}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1.2px', background: 'var(--surface-2)' }}>
          Content Plan Generator
        </div>
        <div style={{ padding: '16px' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const, marginBottom: 12, alignItems: 'center' }}>
            <select value={genClient} onChange={e => setGenClient(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 'var(--radius)', fontSize: 12, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', flexShrink: 0 }}>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-2)', marginRight: 4 }}>Timeframe:</span>
              {[2, 4, 8].map(w => (
                <button key={w} onClick={() => setGenTimeframe(w)} style={pill(genTimeframe === w)}>{w}w</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-2)', marginRight: 4 }}>Posts/week:</span>
              {[1, 2, 3, 4].map(n => (
                <button key={n} onClick={() => setGenPpw(n)} style={pill(genPpw === n)}>{n}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={genFocus}
              onChange={e => setGenFocus(e.target.value)}
              placeholder="Focus (optional) — e.g. 'local services' or leave blank for best opportunities"
              style={{ flex: 1, padding: '8px 12px', borderRadius: 'var(--radius)', fontSize: 13, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}
            />
            <button
              onClick={generatePlan}
              disabled={generating || !genClient}
              style={{ padding: '8px 18px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, cursor: generating ? 'default' : 'pointer', border: 'none', background: generating ? 'var(--surface-3)' : 'var(--brand)', color: generating ? 'var(--text-2)' : 'var(--brand-accent)', whiteSpace: 'nowrap' as const, opacity: generating ? 0.7 : 1 }}>
              {generating ? 'Planning...' : `Generate ${genTimeframe * genPpw}-piece plan`}
            </button>
          </div>
          {generating && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Working</div>
              {genLog.map((msg, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{msg}</div>
              ))}
              {genLog.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>Pulling keyword bank and content history...</div>}
            </div>
          )}
          {genLog.length > 0 && !generating && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--green)', fontWeight: 500 }}>
              Done — calendar updated below.
            </div>
          )}
        </div>
      </div>

      {/* Status flow */}
      {entries.length > 0 && (
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {[
            { label: 'Planned', count: counts.suggested, color: 'var(--text-2)' },
            { label: 'Approved', count: counts.approved, color: 'var(--accent)' },
            { label: 'Scheduled', count: counts.scheduled, color: 'var(--amber)' },
            { label: 'Written', count: counts.written, color: 'var(--purple)' },
            { label: 'Published', count: counts.published, color: 'var(--green)' },
          ].map((s, i) => (
            <div key={s.label} style={{ flex: 1, padding: '10px 14px', borderRight: i < 4 ? '1px solid var(--border)' : 'none', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: 'var(--font-mono)' }}>{s.count}</div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 16, alignItems: 'center' }}>
        {statusFilters.map(f => (
          <button key={f} onClick={() => setStatusFilter(f)} style={pill(statusFilter === f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <div style={{ marginLeft: 8 }}>
          <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: 99, fontSize: 12, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer' }}>
            <option value="all">All clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {Object.keys(byWeek).length === 0 && (
        <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>
          No calendar entries yet. Use the generator above to create a content plan.
        </div>
      )}

      {Object.entries(byWeek).map(([week, weekEntries]) => (
        <div key={week} style={S.panel}>
          <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px', background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{week}</span>
            <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>{weekEntries.length} item{weekEntries.length !== 1 ? 's' : ''}</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: 28 }}>
                  <input type="checkbox" onChange={e => {
                    if (e.target.checked) weekEntries.forEach(en => setChecked(p => new Set([...p, en.id])))
                    else weekEntries.forEach(en => setChecked(p => { const n = new Set(p); n.delete(en.id); return n }))
                  }} />
                </th>
                {['Title', 'Keyword', 'Type', 'Status', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {weekEntries.map((e, i) => (
                <tr key={e.id}
                  onMouseEnter={el => (el.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={el => (el.currentTarget.style.background = 'transparent')}
                  style={{ borderBottom: i < weekEntries.length - 1 ? '1px solid var(--border)' : 'none' }}
                >
                  <td style={{ ...S.td, width: 28 }}>
                    <input type="checkbox" checked={checked.has(e.id)} onChange={() => toggleCheck(e.id)} />
                  </td>
                  <td style={{ ...S.td, fontWeight: 500, maxWidth: 260 }}>
                    {e.output_id
                      ? <Link href={`/outputs/${e.output_id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{e.title}</Link>
                      : <span style={{ color: 'var(--text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{e.title}</span>
                    }
                    {e.notes && <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>{e.notes.slice(0, 100)}</div>}
                  </td>
                  <td style={{ ...S.td, color: 'var(--text-2)', fontSize: 12, maxWidth: 180 }}>
                    {e.primary_keyword
                      ? <span style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2px 8px', fontSize: 11 }}>{e.primary_keyword}</span>
                      : <span style={{ color: 'var(--text-dim)' }}>—</span>
                    }
                  </td>
                  <td style={{ ...S.td, color: 'var(--text-dim)', fontSize: 12 }}>{e.content_type || '—'}</td>
                  <td style={S.td}><StatusPill status={e.status} /></td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                      {/* Write now — opens agent chat with task pre-loaded */}
                      {(e.status === 'planned' || e.status === 'approved') && e.primary_keyword && (
                        <Link href={buildWriteNowUrl(e)}
                          style={{ padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none', background: 'var(--brand)', color: 'var(--brand-accent)', textDecoration: 'none', display: 'inline-block' }}>
                          Write now
                        </Link>
                      )}
                      {e.status === 'planned' && (
                        <button onClick={() => updateStatus(e.id, 'approved')} style={{ padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                          Approve
                        </button>
                      )}
                      {(e.status === 'planned' || e.status === 'approved') && (
                        <button onClick={() => queueEntry(e)} style={{ padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                          Queue
                        </button>
                      )}
                      {e.status !== 'cancelled' && (
                        <button onClick={() => updateStatus(e.id, 'cancelled')} style={{ padding: '4px 8px', borderRadius: 'var(--radius)', fontSize: 11, cursor: 'pointer', border: 'none', background: 'none', color: 'var(--text-dim)' }}>
                          ✕
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Bulk action bar */}
      {checked.size > 0 && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '10px 18px', display: 'flex', gap: 10, alignItems: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.12)', zIndex: 50 }}>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{checked.size} selected</span>
          <button onClick={bulkApprove} style={{ padding: '6px 16px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--accent)', color: '#fff' }}>Approve all</button>
          <button onClick={bulkSchedule} style={{ padding: '6px 16px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--brand)', color: 'var(--brand-accent)' }}>Schedule all</button>
          <button onClick={() => setChecked(new Set())} style={{ padding: '6px 12px', borderRadius: 'var(--radius)', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', background: 'none', color: 'var(--text-2)' }}>Clear</button>
        </div>
      )}
    </div>
  )
}
