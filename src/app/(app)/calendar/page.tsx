'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ContentCalendarEntry } from '@/lib/types'
import Link from 'next/link'

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  planned: { label: 'Planned', color: 'var(--text-2)', bg: 'rgba(122,139,168,0.12)' },
  in_progress: { label: 'In progress', color: 'var(--accent)', bg: 'var(--accent-bg)' },
  published: { label: 'Published', color: 'var(--green)', bg: 'var(--green-bg)' },
  cancelled: { label: 'Cancelled', color: 'var(--red)', bg: 'var(--red-bg)' },
}

const S: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', marginBottom: 24 },
  panelHead: { padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1.2px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '12px 18px', borderBottom: '1px solid var(--border)' },
  td: { padding: '13px 18px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'middle' as const },
}

export default function CalendarPage() {
  const [entries, setEntries] = useState<(ContentCalendarEntry & { client_profiles?: any })[]>([])
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [clientFilter, setClientFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ title: '', primary_keyword: '', content_type: 'blog_post', scheduled_date: '', client_id: '', notes: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('client_profiles').select('id,name').order('name').then(({ data }) => setClients(data || []))
  }, [])

  useEffect(() => { load() }, [clientFilter, statusFilter])

  async function load() {
    let q = supabase
      .from('content_calendar')
      .select('*, client_profiles(name)')
      .order('scheduled_date', { ascending: true, nullsFirst: false })
    if (clientFilter !== 'all') q = q.eq('client_id', clientFilter) as any
    if (statusFilter !== 'all') q = q.eq('status', statusFilter) as any
    const { data } = await q
    setEntries(data || [])
  }

  async function save() {
    if (!form.title.trim() || !form.client_id) return
    setSaving(true)
    await supabase.from('content_calendar').insert({
      ...form,
      scheduled_date: form.scheduled_date || null,
    })
    setSaving(false)
    setAddOpen(false)
    setForm({ title: '', primary_keyword: '', content_type: 'blog_post', scheduled_date: '', client_id: '', notes: '' })
    load()
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from('content_calendar').update({ status }).eq('id', id)
    load()
  }

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  const isPast = (d: string | null) => d ? new Date(d) < new Date() : false

  const groupedByMonth: Record<string, typeof entries> = {}
  for (const e of entries) {
    const key = e.scheduled_date
      ? new Date(e.scheduled_date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      : 'Unscheduled'
    if (!groupedByMonth[key]) groupedByMonth[key] = []
    groupedByMonth[key].push(e)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 36 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.5px' }}>Content calendar</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Plan and track content across all clients. Ada adds entries when building content plans.</p>
        </div>
        <button onClick={() => setAddOpen(true)} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '9px 18px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' }}>
          Add entry
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
          style={{ padding: '6px 12px', borderRadius: 99, fontSize: 12, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer' }}>
          <option value="all">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '6px 12px', borderRadius: 99, fontSize: 12, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer' }}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {entries.length === 0 ? (
        <div style={{ ...S.panel, padding: '64px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>No calendar entries yet</div>
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>Ask Ada to build a content plan for a client, or add entries manually.</p>
          <button onClick={() => setAddOpen(true)} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '9px 18px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' }}>
            Add first entry
          </button>
        </div>
      ) : (
        Object.entries(groupedByMonth).map(([month, items]) => (
          <div key={month} style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>{month}</div>
            <div style={S.panel}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Date', 'Title', 'Client', 'Type', 'Keyword', 'Status', ''].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((e, i) => {
                    const sc = STATUS_CONFIG[e.status] || STATUS_CONFIG.planned
                    const past = isPast(e.scheduled_date) && e.status === 'planned'
                    return (
                      <tr key={e.id}
                        onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--surface-2)')}
                        onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                        style={{ borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}
                      >
                        <td style={{ ...S.td, fontFamily: 'var(--font-mono)', fontSize: 12, color: past ? 'var(--amber)' : 'var(--text-2)', whiteSpace: 'nowrap' }}>
                          {fmt(e.scheduled_date)}
                          {past && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--amber)' }}>overdue</span>}
                        </td>
                        <td style={{ ...S.td, fontWeight: 500, color: 'var(--text)', maxWidth: 240 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e.output_id ? <Link href={`/outputs/${e.output_id}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>{e.title}</Link> : e.title}
                          </div>
                        </td>
                        <td style={{ ...S.td, color: 'var(--text-2)' }}>{(e as any).client_profiles?.name || '—'}</td>
                        <td style={{ ...S.td, color: 'var(--text-2)', fontSize: 12 }}>{e.content_type?.replace('_', ' ') || '—'}</td>
                        <td style={{ ...S.td, color: 'var(--text-2)', fontSize: 12, maxWidth: 160 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.primary_keyword || '—'}</div>
                        </td>
                        <td style={S.td}>
                          <select value={e.status} onChange={async ev => { ev.stopPropagation(); await updateStatus(e.id, ev.target.value) }}
                            style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 99, border: 'none', background: sc.bg, color: sc.color, cursor: 'pointer' }}>
                            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select>
                        </td>
                        <td style={S.td}>
                          {e.output_id
                            ? <Link href={`/outputs/${e.output_id}`} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>View output →</Link>
                            : e.status === 'planned' && (
                              <button onClick={async () => {
                                await supabase.from('content_queue').insert({
                                  client_id: e.client_id,
                                  agent_type: 'ada',
                                  content_type: e.content_type || 'blog_post',
                                  primary_keyword: e.primary_keyword || e.title,
                                  word_count: 1500,
                                  scheduled_for: new Date().toISOString(),
                                  status: 'queued',
                                })
                                await supabase.from('content_calendar').update({ status: 'in_progress' }).eq('id', e.id)
                                load()
                              }} style={{ fontSize: 11, padding: '4px 12px', borderRadius: 99, border: 'none', background: 'var(--accent-bg)', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>
                                Queue now
                              </button>
                            )
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {/* Add entry modal */}
      {addOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setAddOpen(false)}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 32, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 20, letterSpacing: '-0.3px' }}>Add calendar entry</h2>
            {[
              { key: 'title', label: 'Title', type: 'input' },
              { key: 'primary_keyword', label: 'Primary keyword', type: 'input' },
            ].map(({ key, label, type }) => (
              <div key={key} style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{label}</label>
                <input value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Client</label>
                <select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                  <option value="">Select client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Type</label>
                <select value={form.content_type} onChange={e => setForm(f => ({ ...f, content_type: e.target.value }))}>
                  <option value="blog_post">Blog post</option>
                  <option value="pillar_page">Pillar page</option>
                  <option value="category_page">Category page</option>
                  <option value="local_seo">Local SEO</option>
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Scheduled date</label>
              <input type="date" value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={save} disabled={saving || !form.title.trim() || !form.client_id} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '9px 18px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' }}>
                {saving ? 'Saving...' : 'Add entry'}
              </button>
              <button onClick={() => setAddOpen(false)} style={{ background: 'var(--surface-3)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '9px 18px', fontSize: 13.5, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
