'use client'
import { useEffect, useState, useRef } from 'react'
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

const S: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 20 },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '11px 16px', borderBottom: '1px solid var(--border)' },
  td: { padding: '11px 16px', fontSize: 13, verticalAlign: 'top' as const },
}

function pill(active: boolean): React.CSSProperties {
  return { padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: 'none', background: active ? 'var(--accent)' : 'var(--surface-2)', color: active ? '#fff' : 'var(--text-2)', fontWeight: active ? 600 : 400 }
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

function priorityStars(p?: number | null) {
  if (!p) return ''
  if (p >= 3) return '★★★'
  if (p >= 2) return '★★'
  return '★'
}

export default function AgentCalendarPage() {
  const { id: agentId } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<{ name: string } | null>(null)
  const [entries, setEntries] = useState<CalEntry[]>([])
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [clientFilter, setClientFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [checked, setChecked] = useState<Set<string>>(new Set())

  // Generator state
  const [genClient, setGenClient] = useState('')
  const [genTimeframe, setGenTimeframe] = useState(4)
  const [genPpw, setGenPpw] = useState(3)
  const [genFocus, setGenFocus] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genStream, setGenStream] = useState('')
  const streamRef = useRef('')

  useEffect(() => {
    supabase.from('agents').select('name').eq('id', agentId).single().then(({ data }) => setAgent(data))
    supabase.from('client_profiles').select('id,name').order('name').then(({ data }) => {
      setClients(data || [])
      if (data && data.length > 0) setGenClient(data[0].id)
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
    if (!client) return
    setGenerating(true)
    setGenStream('')
    streamRef.current = ''
    const today = new Date().toISOString().split('T')[0]
    const focus = genFocus.trim() || 'highest opportunity keywords based on GSC data and keyword bank'
    const message = `You are creating a content plan for ${client.name}.\nTimeframe: ${genTimeframe} weeks starting ${today}.\nTarget: ${genPpw} posts per week.\nFocus: ${focus}.\nUse your tools to check keyword bank, GSC data, content history, and competitors.\nThen call create_content_plan for each recommended item.\nEach item needs: primary_keyword, content_type, title_brief, rationale, priority, suggested_publish_date.\nSequence by commercial impact.`

    // Get the system prompt — build minimal version
    const { data: agentData } = await supabase.from('agents').select('*').eq('id', agentId).single()
    const systemPrompt = agentData ? `You are ${agentData.name}, ${agentData.role}. ${agentData.instructions || ''}` : 'You are an SEO agent.'

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
      }),
    })
    const data = await res.json()
    if (data.content) {
      const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      setGenStream(text)
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

  // Status counts for flow indicator
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
        <h1 style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.5px' }}>Content Calendar</h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>Plan and track content production.</p>
      </div>

      {/* Content Plan Generator */}
      <div style={{ ...S.panel, border: '1px solid var(--border)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
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
              placeholder="Focus (optional) — e.g. 'ear wax removal' or leave blank for best opportunities"
              style={{ flex: 1, padding: '8px 12px', borderRadius: 'var(--radius)', fontSize: 13, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}
            />
            <button
              onClick={generatePlan}
              disabled={generating || !genClient}
              style={{ padding: '8px 18px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, cursor: generating ? 'default' : 'pointer', border: 'none', background: generating ? 'var(--surface-3)' : 'var(--accent)', color: generating ? 'var(--text-2)' : '#fff', whiteSpace: 'nowrap' as const, opacity: generating ? 0.7 : 1 }}>
              {generating ? 'Ada is planning...' : 'Generate plan with Ada →'}
            </button>
          </div>
          {generating && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-2)', fontStyle: 'italic' }}>
              Ada is analysing your keyword bank, GSC data and content history...
            </div>
          )}
          {genStream && !generating && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7, maxHeight: 180, overflowY: 'auto' as const }}>
              {genStream}
            </div>
          )}
        </div>
      </div>

      {/* Status flow indicator */}
      {entries.length > 0 && (
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {[
            { label: 'Suggested', count: counts.suggested, color: 'var(--text-2)' },
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
          <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px' }}>
            {week} <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>· {weekEntries.length} items</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: 28 }}><input type="checkbox" onChange={e => { if (e.target.checked) weekEntries.forEach(en => setChecked(p => new Set([...p, en.id]))); else weekEntries.forEach(en => setChecked(p => { const n = new Set(p); n.delete(en.id); return n })) }} /></th>
                {['Title', 'Type', 'Keyword', 'Priority', 'Status', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {weekEntries.map((e, i) => (
                <tr key={e.id}
                  onMouseEnter={el => (el.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={el => (el.currentTarget.style.background = 'transparent')}
                  style={{ borderBottom: i < weekEntries.length - 1 ? '1px solid var(--border)' : 'none' }}
                >
                  <td style={{ ...S.td, width: 28 }}><input type="checkbox" checked={checked.has(e.id)} onChange={() => toggleCheck(e.id)} /></td>
                  <td style={{ ...S.td, fontWeight: 500, maxWidth: 220 }}>
                    {e.output_id
                      ? <Link href={`/outputs/${e.output_id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{e.title}</Link>
                      : e.title}
                    {e.notes && <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>{e.notes}</div>}
                  </td>
                  <td style={{ ...S.td, color: 'var(--text-2)', fontSize: 12 }}>{e.content_type || '—'}</td>
                  <td style={{ ...S.td, color: 'var(--text-2)', fontSize: 12 }}>{e.primary_keyword || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--amber)' }}>{priorityStars(e.priority)}</td>
                  <td style={S.td}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[e.status] || 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{e.status}</span>
                  </td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {e.status === 'planned' && (
                        <button onClick={() => updateStatus(e.id, 'approved')} style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                          Approve
                        </button>
                      )}
                      {(e.status === 'planned' || e.status === 'approved') && (
                        <button onClick={() => queueEntry(e)} style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--accent)', color: '#fff' }}>
                          Schedule
                        </button>
                      )}
                      {e.status !== 'cancelled' && (
                        <button onClick={() => updateStatus(e.id, 'cancelled')} style={{ padding: '3px 8px', borderRadius: 99, fontSize: 11, cursor: 'pointer', border: 'none', background: 'none', color: 'var(--text-dim)' }}>
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
          <button onClick={bulkSchedule} style={{ padding: '6px 16px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--green)', color: '#fff' }}>Schedule all</button>
          <button onClick={() => setChecked(new Set())} style={{ padding: '6px 12px', borderRadius: 'var(--radius)', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', background: 'none', color: 'var(--text-2)' }}>Clear</button>
        </div>
      )}
    </div>
  )
}
