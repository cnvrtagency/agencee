'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const STATUS_COLOR: Record<string, string> = {
  suggested: 'var(--text-dim)',
  planned: 'var(--text-dim)',
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

const PROGRESS_STAGES = [
  'Reading keyword bank...',
  'Analysing GSC data...',
  'Checking content history...',
  'Building the plan...',
]

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type CalEntry = {
  id: string
  client_id: string
  title: string
  primary_keyword: string | null
  content_type: string | null
  scheduled_date: string | null
  status: string
  notes: string | null
  rationale?: string | null
  priority?: number | null
  output_id?: string | null
  client_profiles?: { name: string } | null
}

function pillStyle(active: boolean, color = 'var(--brand)'): React.CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 'var(--radius-md)', fontSize: 12, cursor: 'pointer', border: 'none',
    background: active ? color : 'var(--surface-2)',
    color: active ? '#fff' : 'var(--text-2)',
    fontWeight: active ? 600 : 400,
  }
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

function PriorityStars({ priority }: { priority: number | null | undefined }) {
  const n = Math.min(3, Math.max(1, priority || 2))
  return <span style={{ color: 'var(--amber)', fontSize: 13, letterSpacing: 1 }}>{'★'.repeat(n)}{'☆'.repeat(3 - n)}</span>
}

const S: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 20 },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '11px 16px', borderBottom: '1px solid var(--border)' },
  td: { padding: '11px 16px', fontSize: 13, verticalAlign: 'top' as const },
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function AgentCalendarPage() {
  const { id: agentId } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<{ name: string; slug: string } | null>(null)
  const [entries, setEntries] = useState<CalEntry[]>([])
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [clientFilter, setClientFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [checked, setChecked] = useState<Set<string>>(new Set())

  // View state
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selectedEntry, setSelectedEntry] = useState<CalEntry | null>(null)
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set())
  const [isMobile, setIsMobile] = useState(false)

  // Generator state
  const [genClient, setGenClient] = useState('')
  const [genTimeframe, setGenTimeframe] = useState(4)
  const [genPpw, setGenPpw] = useState(3)
  const [genFocus, setGenFocus] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genStage, setGenStage] = useState(0)
  const [genError, setGenError] = useState<string | null>(null)
  const [genSummary, setGenSummary] = useState<string | null>(null)

  const calendarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    supabase.from('agents').select('name,slug').eq('id', agentId).single().then(({ data }) => setAgent(data))
    supabase.from('client_profiles').select('id,name').order('name').then(({ data }) => {
      setClients(data || [])
      if (data && data.length > 0) setGenClient(data[0].id)
    })
  }, [agentId])

  useEffect(() => { load() }, [clientFilter, statusFilter])

  useEffect(() => {
    if (!generating) return
    const interval = setInterval(() => setGenStage(prev => Math.min(prev + 1, PROGRESS_STAGES.length - 1)), 4000)
    return () => clearInterval(interval)
  }, [generating])

  async function load() {
    let q = supabase.from('content_calendar').select('*, client_profiles(name)').order('scheduled_date', { ascending: true, nullsFirst: false })
    if (clientFilter !== 'all') q = q.eq('client_id', clientFilter) as any
    if (statusFilter !== 'all') q = q.eq('status', statusFilter) as any
    const { data } = await q
    setEntries(data || [])
  }

  async function generatePlan() {
    if (!genClient || generating) return
    setGenerating(true)
    setGenStage(0)
    setGenError(null)
    setGenSummary(null)
    try {
      const res = await fetch('/api/calendar/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: genClient, weeks: genTimeframe, posts_per_week: genPpw, focus: genFocus.trim() || null, agent_id: agentId }),
      })
      const data: any = await res.json()
      if (!res.ok || data.error) {
        setGenError(data.error || 'Generation failed')
      } else {
        setGenSummary(data.summary || null)
        await load()
        setTimeout(() => calendarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
      }
    } catch (e: any) {
      setGenError(e.message || 'Generation failed')
    }
    setGenerating(false)
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from('content_calendar').update({ status }).eq('id', id)
    setEntries(prev => prev.map(e => e.id === id ? { ...e, status } : e))
    if (selectedEntry?.id === id) setSelectedEntry(prev => prev ? { ...prev, status } : null)
  }

  async function updateDate(id: string, date: string | null) {
    await supabase.from('content_calendar').update({ scheduled_date: date }).eq('id', id)
    setEntries(prev => prev.map(e => e.id === id ? { ...e, scheduled_date: date } : e))
    if (selectedEntry?.id === id) setSelectedEntry(prev => prev ? { ...prev, scheduled_date: date } : null)
  }

  async function queueEntry(entry: CalEntry) {
    const scheduledFor = entry.scheduled_date
      ? new Date(entry.scheduled_date + 'T09:00:00').toISOString()
      : new Date().toISOString()
    await supabase.from('content_queue').insert({
      client_id: entry.client_id,
      agent_type: 'seo',
      content_type: entry.content_type || 'blog_post',
      primary_keyword: entry.primary_keyword || entry.title,
      word_count: 1500,
      scheduled_for: scheduledFor,
      status: 'queued',
      calendar_id: entry.id,
    })
    await supabase.from('content_calendar').update({ status: 'scheduled' }).eq('id', entry.id)
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: 'scheduled' } : e))
    if (selectedEntry?.id === entry.id) setSelectedEntry(prev => prev ? { ...prev, status: 'scheduled' } : null)
  }

  async function writeNowEntry(entry: CalEntry) {
    await supabase.from('content_queue').insert({
      client_id: entry.client_id,
      agent_type: 'seo',
      content_type: entry.content_type || 'blog_post',
      primary_keyword: entry.primary_keyword || entry.title,
      word_count: 1500,
      scheduled_for: new Date().toISOString(),
      status: 'queued',
      calendar_id: entry.id,
    })
    await supabase.from('content_calendar').update({ status: 'in_progress' }).eq('id', entry.id)
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: 'in_progress' } : e))
    setSelectedEntry(null)
  }

  async function bulkApprove() {
    for (const id of checked) await updateStatus(id, 'approved')
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
    const clientName = (entry.client_profiles as any)?.name || 'the client'
    const msg = `Write a complete, publish-ready blog post for ${clientName} targeting the keyword "${entry.primary_keyword || entry.title}". ${entry.notes ? `Angle: ${entry.notes}` : ''} Check search_history first to avoid repeating angles, then write the full post with images and save it with write_content.`
    return `/agents/${agentId}?draft=${encodeURIComponent(msg)}&send=1`
  }

  // Calendar grid data
  const entriesByDate: Record<string, CalEntry[]> = {}
  entries.forEach(e => {
    if (e.scheduled_date) {
      entriesByDate[e.scheduled_date] = entriesByDate[e.scheduled_date] || []
      entriesByDate[e.scheduled_date].push(e)
    }
  })
  const unscheduled = entries.filter(e => !e.scheduled_date && e.status !== 'cancelled' && e.status !== 'published')

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()
  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const calDays: (Date | null)[] = []
  for (let i = 0; i < firstDayOfWeek; i++) calDays.push(null)
  for (let d = 1; d <= daysInMonth; d++) calDays.push(new Date(year, month, d))
  while (calDays.length % 7 !== 0) calDays.push(null)

  const todayStr = localDateStr(new Date())
  const monthName = currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  // List view grouping
  const byWeek: Record<string, CalEntry[]> = {}
  entries.forEach(e => {
    const d = e.scheduled_date
    let weekLabel = 'Unscheduled'
    if (d) {
      const date = new Date(d + 'T00:00:00')
      const day = date.getDay()
      const monday = new Date(date)
      monday.setDate(date.getDate() - day + (day === 0 ? -6 : 1))
      weekLabel = `Week of ${monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
    }
    if (!byWeek[weekLabel]) byWeek[weekLabel] = []
    byWeek[weekLabel].push(e)
  })

  const counts = {
    planned: entries.filter(e => e.status === 'suggested' || e.status === 'planned').length,
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

      {/* Generator */}
      <div style={S.panel}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1.2px', background: 'var(--surface-2)' }}>
          Content Plan Generator
        </div>
        <div style={{ padding: '16px' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const, marginBottom: 12, alignItems: 'center' }}>
            <select value={genClient} onChange={e => setGenClient(e.target.value)} disabled={generating}
              style={{ padding: '6px 10px', borderRadius: 'var(--radius)', fontSize: 12, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', opacity: generating ? 0.6 : 1 }}>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-2)', marginRight: 4 }}>Timeframe:</span>
              {[2, 4, 8].map(w => (
                <button key={w} onClick={() => setGenTimeframe(w)} disabled={generating} style={pillStyle(genTimeframe === w)}>{w}w</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-2)', marginRight: 4 }}>Posts/week:</span>
              {[1, 2, 3, 4].map(n => (
                <button key={n} onClick={() => setGenPpw(n)} disabled={generating} style={pillStyle(genPpw === n)}>{n}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={genFocus}
              onChange={e => setGenFocus(e.target.value)}
              disabled={generating}
              placeholder="Focus (optional) -- e.g. 'local services' or leave blank for best opportunities"
              style={{ flex: 1, padding: '8px 12px', borderRadius: 'var(--radius)', fontSize: 13, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', opacity: generating ? 0.6 : 1 }}
            />
            <button
              onClick={generatePlan}
              disabled={generating || !genClient}
              style={{ padding: '8px 18px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, cursor: generating ? 'default' : 'pointer', border: 'none', background: generating ? 'var(--surface-3)' : 'var(--brand)', color: generating ? 'var(--text-2)' : 'var(--brand-accent)', whiteSpace: 'nowrap' as const, opacity: generating ? 0.7 : 1 }}>
              Generate plan
            </button>
          </div>

          {generating && (
            <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 'var(--radius)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              {PROGRESS_STAGES.map((stage, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', opacity: i <= genStage ? 1 : 0.3 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: i < genStage ? 'var(--green)' : i === genStage ? 'var(--brand)' : 'var(--border)' }} />
                  <span style={{ fontSize: 12, color: i === genStage ? 'var(--text)' : 'var(--text-2)' }}>{stage}</span>
                </div>
              ))}
            </div>
          )}

          {genError && !generating && (
            <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--red-bg)', border: '1px solid var(--red)', fontSize: 13, color: 'var(--red)' }}>
              {genError}
            </div>
          )}
        </div>
      </div>

      {/* Ada summary */}
      {genSummary && (
        <div style={{ marginBottom: 20, padding: '14px 18px', borderRadius: 'var(--radius-lg)', background: 'var(--accent-bg)', border: '1px solid var(--accent)', fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
          <span style={{ fontWeight: 700, color: 'var(--accent)', marginRight: 8 }}>Ada's plan:</span>{genSummary}
        </div>
      )}

      {/* Status flow */}
      {entries.length > 0 && (
        <div style={{ display: 'flex', marginBottom: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {[
            { label: 'Planned', count: counts.planned, color: 'var(--text-2)' },
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

      {/* Filters + view toggle */}
      <div ref={calendarRef} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, alignItems: 'center' }}>
          {statusFilters.map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} style={pillStyle(statusFilter === f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: 99, fontSize: 12, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer' }}>
            <option value="all">All clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 2, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 2 }}>
          {(['calendar', 'list'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '5px 14px', borderRadius: 'var(--radius)', fontSize: 12, cursor: 'pointer', border: 'none',
              background: view === v ? 'var(--surface)' : 'transparent',
              color: view === v ? 'var(--text)' : 'var(--text-2)',
              fontWeight: view === v ? 600 : 400,
              boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}>
              {v === 'calendar' ? 'Calendar' : 'List'}
            </button>
          ))}
        </div>
      </div>

      {entries.length === 0 && (
        <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>
          No calendar entries yet. Use the generator above to create a content plan.
        </div>
      )}

      {/* Calendar view */}
      {view === 'calendar' && entries.length > 0 && (
        <div style={S.panel}>
          {/* Month header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <button onClick={() => { setCurrentMonth(new Date(year, month - 1, 1)); setExpandedCells(new Set()) }}
              style={{ padding: '4px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>&#8249;</button>
            <button onClick={() => { setCurrentMonth(new Date(year, month + 1, 1)); setExpandedCells(new Set()) }}
              style={{ padding: '4px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>&#8250;</button>
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', flex: 1 }}>{monthName}</span>
            <button onClick={() => { const d = new Date(); setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setExpandedCells(new Set()) }}
              style={{ padding: '4px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 12 }}>Today</button>
          </div>

          {isMobile ? (
            /* Mobile agenda */
            <div>
              {(() => {
                const monthEntries = entries
                  .filter(e => { if (!e.scheduled_date) return false; const d = new Date(e.scheduled_date + 'T00:00:00'); return d.getFullYear() === year && d.getMonth() === month })
                  .sort((a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || ''))
                if (monthEntries.length === 0) return <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>No entries this month.</div>
                const grouped: Record<string, CalEntry[]> = {}
                monthEntries.forEach(e => { grouped[e.scheduled_date!] = grouped[e.scheduled_date!] || []; grouped[e.scheduled_date!].push(e) })
                return Object.entries(grouped).map(([ds, dayEntries]) => (
                  <div key={ds} style={{ borderBottom: '1px solid var(--border)' }}>
                    <div style={{ padding: '8px 16px', background: 'var(--surface-2)', fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                      {new Date(ds + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </div>
                    {dayEntries.map(e => (
                      <div key={e.id} onClick={() => setSelectedEntry(e)}
                        style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                        onMouseEnter={el => (el.currentTarget.style.background = 'var(--surface-2)')}
                        onMouseLeave={el => (el.currentTarget.style.background = 'transparent')}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[e.status] || 'var(--text-dim)', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{e.title}</span>
                        <StatusPill status={e.status} />
                      </div>
                    ))}
                  </div>
                ))
              })()}
            </div>
          ) : (
            /* Desktop grid */
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                {DAY_HEADERS.map(d => (
                  <div key={d} style={{ padding: '6px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{d}</div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {calDays.map((day, i) => {
                  const isLastRow = i >= calDays.length - 7
                  const isLastCol = (i + 1) % 7 === 0
                  if (!day) {
                    return (
                      <div key={`e${i}`} style={{ minHeight: 96, background: 'var(--surface-2)', opacity: 0.5, borderRight: !isLastCol ? '1px solid var(--border)' : 'none', borderBottom: !isLastRow ? '1px solid var(--border)' : 'none' }} />
                    )
                  }
                  const ds = localDateStr(day)
                  const dayEntries = entriesByDate[ds] || []
                  const isToday = ds === todayStr
                  const isExpanded = expandedCells.has(ds)
                  const visible = isExpanded ? dayEntries : dayEntries.slice(0, 3)
                  const hidden = dayEntries.length - 3
                  return (
                    <div key={ds} style={{ minHeight: 96, padding: '6px', borderRight: !isLastCol ? '1px solid var(--border)' : 'none', borderBottom: !isLastRow ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? '#fff' : 'var(--text-2)', background: isToday ? 'var(--brand)' : 'transparent', marginBottom: 4 }}>
                        {day.getDate()}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {visible.map(e => (
                          <div key={e.id} onClick={() => setSelectedEntry(e)}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 5px', borderRadius: 4, background: 'var(--surface-2)', cursor: 'pointer', fontSize: 11, lineHeight: 1.3 }}
                            onMouseEnter={el => (el.currentTarget.style.background = STATUS_BG[e.status] || 'var(--surface-3)')}
                            onMouseLeave={el => (el.currentTarget.style.background = 'var(--surface-2)')}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[e.status] || 'var(--text-dim)', flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{e.title}</span>
                          </div>
                        ))}
                        {!isExpanded && hidden > 0 && (
                          <button onClick={() => setExpandedCells(prev => { const n = new Set(prev); n.add(ds); return n })}
                            style={{ fontSize: 10, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 5px', textAlign: 'left' }}>
                            +{hidden} more
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Unscheduled strip */}
          {unscheduled.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Unscheduled</div>
              <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                {unscheduled.map(e => (
                  <div key={e.id} onClick={() => setSelectedEntry(e)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 'var(--radius)', background: 'var(--surface-2)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 11 }}
                    onMouseEnter={el => (el.currentTarget.style.background = 'var(--surface-3)')}
                    onMouseLeave={el => (el.currentTarget.style.background = 'var(--surface-2)')}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[e.status] || 'var(--text-dim)', flexShrink: 0 }} />
                    <span style={{ color: 'var(--text)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* List view */}
      {view === 'list' && entries.length > 0 && (
        <>
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
                      <input type="checkbox" onChange={ev => {
                        if (ev.target.checked) weekEntries.forEach(en => setChecked(p => new Set([...p, en.id])))
                        else weekEntries.forEach(en => setChecked(p => { const n = new Set(p); n.delete(en.id); return n }))
                      }} />
                    </th>
                    {['Title', 'Keyword', 'Type', 'Status', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {weekEntries.map((e, i) => (
                    <tr key={e.id}
                      onClick={() => setSelectedEntry(e)}
                      onMouseEnter={el => (el.currentTarget.style.background = 'var(--surface-2)')}
                      onMouseLeave={el => (el.currentTarget.style.background = 'transparent')}
                      style={{ borderBottom: i < weekEntries.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
                      <td style={{ ...S.td, width: 28 }} onClick={ev => ev.stopPropagation()}>
                        <input type="checkbox" checked={checked.has(e.id)} onChange={() => toggleCheck(e.id)} />
                      </td>
                      <td style={{ ...S.td, fontWeight: 500, maxWidth: 260 }}>
                        {e.output_id
                          ? <Link href={`/outputs/${e.output_id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }} onClick={ev => ev.stopPropagation()}>{e.title}</Link>
                          : <span style={{ color: 'var(--text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{e.title}</span>
                        }
                        {e.notes && <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>{e.notes.slice(0, 100)}</div>}
                      </td>
                      <td style={{ ...S.td, color: 'var(--text-2)', fontSize: 12, maxWidth: 180 }}>
                        {e.primary_keyword
                          ? <span style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2px 8px', fontSize: 11 }}>{e.primary_keyword}</span>
                          : <span style={{ color: 'var(--text-dim)' }}>--</span>}
                      </td>
                      <td style={{ ...S.td, color: 'var(--text-dim)', fontSize: 12 }}>{e.content_type || '--'}</td>
                      <td style={S.td}><StatusPill status={e.status} /></td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }} onClick={ev => ev.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                          {(e.status === 'planned' || e.status === 'approved') && e.primary_keyword && (
                            <Link href={buildWriteNowUrl(e)}
                              style={{ padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 11, fontWeight: 700, background: 'var(--brand)', color: 'var(--brand-accent)', textDecoration: 'none', display: 'inline-block' }}>
                              Write now
                            </Link>
                          )}
                          {e.status === 'planned' && (
                            <button onClick={() => updateStatus(e.id, 'approved')}
                              style={{ padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                              Approve
                            </button>
                          )}
                          {(e.status === 'planned' || e.status === 'approved') && (
                            <button onClick={() => queueEntry(e)}
                              style={{ padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                              Queue
                            </button>
                          )}
                          {e.status !== 'cancelled' && (
                            <button onClick={() => updateStatus(e.id, 'cancelled')}
                              style={{ padding: '4px 8px', borderRadius: 'var(--radius)', fontSize: 11, cursor: 'pointer', border: 'none', background: 'none', color: 'var(--text-dim)' }}>
                              x
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
        </>
      )}

      {/* Entry detail drawer */}
      {selectedEntry && (
        <>
          <div onClick={() => setSelectedEntry(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100 }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, maxWidth: '100vw', background: 'var(--surface)', borderLeft: '1px solid var(--border)', zIndex: 101, overflowY: 'auto', padding: 24, boxShadow: '-4px 0 24px rgba(0,0,0,0.12)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4, flex: 1, marginRight: 12 }}>{selectedEntry.title}</h2>
              <button onClick={() => setSelectedEntry(null)} style={{ flexShrink: 0, padding: '4px 8px', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 20, lineHeight: 1 }}>x</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {(selectedEntry.client_profiles as any)?.name && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Client</div>
                  <div style={{ fontSize: 13, color: 'var(--text)' }}>{(selectedEntry.client_profiles as any).name}</div>
                </div>
              )}
              {selectedEntry.primary_keyword && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Keyword</div>
                  <span style={{ display: 'inline-block', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2px 10px', fontSize: 12, color: 'var(--text-2)' }}>{selectedEntry.primary_keyword}</span>
                </div>
              )}
              {selectedEntry.content_type && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Type</div>
                  <div style={{ fontSize: 13, color: 'var(--text)' }}>{selectedEntry.content_type.replace(/_/g, ' ')}</div>
                </div>
              )}
              {selectedEntry.priority != null && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Priority</div>
                  <PriorityStars priority={selectedEntry.priority} />
                </div>
              )}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Status</div>
                <StatusPill status={selectedEntry.status} />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Scheduled date</div>
                <input
                  type="date"
                  value={selectedEntry.scheduled_date || ''}
                  onChange={e => updateDate(selectedEntry.id, e.target.value || null)}
                  style={{ padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13, width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              {selectedEntry.rationale && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Rationale</div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{selectedEntry.rationale}</div>
                </div>
              )}
              {selectedEntry.notes && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Angle</div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{selectedEntry.notes}</div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {selectedEntry.status === 'planned' && (
                <>
                  <button onClick={() => updateStatus(selectedEntry.id, 'approved')}
                    style={{ padding: '9px 16px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--brand)', color: 'var(--brand-accent)', width: '100%' }}>
                    Approve
                  </button>
                  <button onClick={() => { updateStatus(selectedEntry.id, 'cancelled'); setSelectedEntry(null) }}
                    style={{ padding: '9px 16px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--border)', background: 'none', color: 'var(--text-2)', width: '100%' }}>
                    Cancel
                  </button>
                </>
              )}
              {selectedEntry.status === 'approved' && (
                <>
                  <button onClick={() => writeNowEntry(selectedEntry)}
                    style={{ padding: '9px 16px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', background: 'var(--brand)', color: 'var(--brand-accent)', width: '100%' }}>
                    Write now
                  </button>
                  <button onClick={async () => { await queueEntry(selectedEntry); setSelectedEntry(null) }}
                    style={{ padding: '9px 16px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', width: '100%' }}>
                    Schedule
                  </button>
                  <button onClick={() => { updateStatus(selectedEntry.id, 'cancelled'); setSelectedEntry(null) }}
                    style={{ padding: '9px 16px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--border)', background: 'none', color: 'var(--text-2)', width: '100%' }}>
                    Cancel
                  </button>
                </>
              )}
              {(selectedEntry.status === 'in_progress' || selectedEntry.status === 'scheduled') && (
                <div style={{ fontSize: 13, color: 'var(--text-2)', textAlign: 'center', padding: '8px 0' }}>
                  {selectedEntry.status === 'in_progress' ? 'In progress' : 'Scheduled for processing'}
                </div>
              )}
              {(selectedEntry.status === 'written' || selectedEntry.status === 'published') && selectedEntry.output_id && (
                <Link href={`/outputs/${selectedEntry.output_id}`}
                  style={{ display: 'block', padding: '9px 16px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, background: 'var(--green-bg)', color: 'var(--green)', textAlign: 'center', textDecoration: 'none' }}>
                  View output
                </Link>
              )}
            </div>
          </div>
        </>
      )}

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
