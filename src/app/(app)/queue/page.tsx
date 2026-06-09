'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { QueueItem, Client } from '@/lib/types'
import StatusBadge from '@/components/StatusBadge'

type Keyword = { id: string; keyword: string; cluster: string | null; intent: string | null; funnel_stage: string | null }
type PlannedTask = { id: string; client_id: string; content_type: string; primary_keyword: string; supporting_keywords: string[]; title_brief: string; word_count: number; internal_links: string; notes: string; status: string; agent_id: string; agents?: { name: string; role: string } }

const S = {
  h1: { fontSize: 26, fontWeight: 600, color: '#E2E4EE', marginBottom: 4 } as React.CSSProperties,
  sub: { fontSize: 14, color: '#8B91A8', marginBottom: 32 } as React.CSSProperties,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 } as React.CSSProperties,
  btn: { background: '#6366F1', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  panel: { background: '#141720', border: '1px solid #252836', borderRadius: 10, overflow: 'hidden' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#8B91A8', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '12px 16px', borderBottom: '1px solid #252836' },
  td: { padding: '14px 16px', fontSize: 14, borderBottom: '1px solid #1C1F2A', verticalAlign: 'middle' as const },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { background: '#141720', border: '1px solid #252836', borderRadius: 12, padding: 32, width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' as const },
  label: { fontSize: 12, fontWeight: 500, color: '#8B91A8', marginBottom: 6, display: 'block', textTransform: 'uppercase' as const, letterSpacing: '0.8px' },
  field: { marginBottom: 18 } as React.CSSProperties,
  plannedCard: { background: '#1C1F2A', border: '1px solid #252836', borderRadius: 10, padding: '16px 18px', cursor: 'pointer', transition: 'border-color 0.12s' } as React.CSSProperties,
}

const blank = { client_id: '', agent_id: '', content_type: 'blog_post', primary_keyword: '', supporting_keywords: [] as string[], title_brief: '', word_count: '1200', scheduled_for: '', internal_links: '', notes: '' }

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [plannedTasks, setPlannedTasks] = useState<PlannedTask[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all')
  const [newKw, setNewKw] = useState('')
  const [addingKw, setAddingKw] = useState(false)
  const [kwMode, setKwMode] = useState<'primary' | 'supporting' | null>(null)

  useEffect(() => { load() }, [])
  useEffect(() => { if (form.client_id) loadKeywords(form.client_id) }, [form.client_id])

  async function load() {
    const [{ data: q }, { data: c }, { data: a }, { data: p }] = await Promise.all([
      supabase.from('content_queue').select('*, client_profiles(name)').order('scheduled_for', { ascending: false }).limit(50),
      supabase.from('client_profiles').select('id,name').order('name'),
      supabase.from('agents').select('id,name,role').order('name'),
      supabase.from('planned_tasks').select('*, agents(name,role)').neq('status', 'scheduled').order('created_at', { ascending: false }),
    ])
    setItems(q || [])
    setClients(c || [])
    setAgents(a || [])
    setPlannedTasks(p || [])
  }

  async function loadKeywords(clientId: string) {
    const { data } = await supabase.from('keyword_banks').select('id,keyword,cluster,intent,funnel_stage').eq('client_id', clientId).order('priority')
    setKeywords(data || [])
  }

  function set(k: string, v: any) { setForm(f => ({ ...f, [k]: v })) }

  function toggleSupporting(kw: string) {
    setForm(f => ({
      ...f,
      supporting_keywords: f.supporting_keywords.includes(kw)
        ? f.supporting_keywords.filter(k => k !== kw)
        : [...f.supporting_keywords, kw],
    }))
  }

  async function addNewKeyword(forPrimary: boolean) {
    if (!newKw.trim() || !form.client_id) return
    setAddingKw(true)
    await supabase.from('keyword_banks').insert({ client_id: form.client_id, keyword: newKw.trim(), priority: 5 })
    if (forPrimary) {
      set('primary_keyword', newKw.trim())
    } else {
      toggleSupporting(newKw.trim())
    }
    setNewKw('')
    setKwMode(null)
    setAddingKw(false)
    loadKeywords(form.client_id)
  }

  function fillFromPlanned(task: PlannedTask) {
    const agent = agents.find(a => a.id === task.agent_id)
    setForm({
      client_id: task.client_id,
      agent_id: task.agent_id,
      content_type: task.content_type,
      primary_keyword: task.primary_keyword,
      supporting_keywords: task.supporting_keywords || [],
      title_brief: task.title_brief || '',
      word_count: String(task.word_count || 1200),
      scheduled_for: '',
      internal_links: task.internal_links || '',
      notes: task.notes || '',
    })
    // store planned task id to mark as scheduled
    ;(window as any).__plannedTaskId = task.id
  }

  async function save() {
    if (!form.client_id || !form.primary_keyword || !form.scheduled_for) return
    setSaving(true)
    await supabase.from('content_queue').insert({
      client_id: form.client_id,
      agent_type: agents.find(a => a.id === form.agent_id)?.role?.toLowerCase().replace(/\s+/g, '_') || 'seo',
      content_type: form.content_type,
      primary_keyword: form.primary_keyword,
      supporting_keywords: form.supporting_keywords,
      title_brief: form.title_brief || null,
      word_count: parseInt(form.word_count) || 1200,
      scheduled_for: new Date(form.scheduled_for).toISOString(),
      status: 'queued',
    })
    // Mark planned task as scheduled if applicable
    const plannedId = (window as any).__plannedTaskId
    if (plannedId) {
      await supabase.from('planned_tasks').update({ status: 'scheduled' }).eq('id', plannedId)
      delete (window as any).__plannedTaskId
    }
    setSaving(false)
    setOpen(false)
    setForm(blank)
    load()
  }

  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter)
  const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const availableKeywords = keywords.filter(k => k.keyword !== form.primary_keyword)

  return (
    <div>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>Queue</h1>
          <p style={S.sub}>Schedule tasks for your agents. The worker picks them up automatically.</p>
        </div>
        <button style={S.btn} onClick={() => { setOpen(true); delete (window as any).__plannedTaskId }}>Schedule task</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['all', 'queued', 'running', 'review', 'done', 'failed'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', border: 'none', background: filter === f ? '#6366F1' : '#1C1F2A', color: filter === f ? '#fff' : '#8B91A8', fontWeight: filter === f ? 500 : 400, textTransform: 'capitalize' }}>{f}</button>
        ))}
      </div>

      <div style={S.panel}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Keyword</th>
              <th style={S.th}>Client</th>
              <th style={S.th}>Type</th>
              <th style={S.th}>Scheduled</th>
              <th style={S.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id}>
                <td style={{ ...S.td, color: '#E2E4EE', fontWeight: 500 }}>{item.primary_keyword}</td>
                <td style={{ ...S.td, color: '#8B91A8' }}>{(item.client_profiles as any)?.name || '—'}</td>
                <td style={{ ...S.td, color: '#8B91A8', fontSize: 12, textTransform: 'capitalize' }}>{item.content_type?.replace('_', ' ')}</td>
                <td style={{ ...S.td, color: '#8B91A8', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>{fmt(item.scheduled_for)}</td>
                <td style={S.td}><StatusBadge status={item.status} /></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={5} style={{ ...S.td, color: '#8B91A8', textAlign: 'center', padding: '40px 16px' }}>No tasks found.</td></tr>}
          </tbody>
        </table>
      </div>

      {open && (
        <div style={S.overlay} onClick={() => setOpen(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 6, color: '#E2E4EE' }}>Schedule a task</h2>
            <p style={{ fontSize: 14, color: '#8B91A8', marginBottom: 24 }}>The worker picks this up at the scheduled time.</p>

            {/* Planned tasks */}
            {plannedTasks.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#8B91A8', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 12 }}>Planned by your agents</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                  {plannedTasks.map(t => {
                    const client = clients.find(c => c.id === t.client_id)
                    return (
                      <div key={t.id} style={S.plannedCard}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = '#6366F1')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = '#252836')}
                        onClick={() => fillFromPlanned(t)}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 500, color: '#E2E4EE', marginBottom: 3 }}>{t.primary_keyword}</div>
                            <div style={{ fontSize: 12, color: '#8B91A8' }}>
                              {client?.name} · {t.content_type.replace(/_/g, ' ')}
                              {t.agents && <span style={{ color: '#6366F1' }}> · {(t.agents as any).name}</span>}
                            </div>
                            {t.title_brief && <div style={{ fontSize: 12, color: '#8B91A8', marginTop: 4, fontStyle: 'italic' }}>{t.title_brief}</div>}
                          </div>
                          <span style={{ fontSize: 11, color: t.status === 'ready' ? '#34D399' : '#F59E0B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0, marginLeft: 12 }}>{t.status}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontSize: 12, color: '#5A6070', marginTop: 10 }}>Click a planned task to pre-fill the form below.</div>
                <div style={{ borderBottom: '1px solid #252836', marginTop: 20, marginBottom: 20 }} />
              </div>
            )}

            {/* Client */}
            <div style={S.field}>
              <label style={S.label}>Client</label>
              <select value={form.client_id} onChange={e => { set('client_id', e.target.value); set('primary_keyword', ''); set('supporting_keywords', []) }}>
                <option value="">Select client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Agent */}
            <div style={S.field}>
              <label style={S.label}>Agent</label>
              <select value={form.agent_id} onChange={e => set('agent_id', e.target.value)}>
                <option value="">Select agent</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
              </select>
            </div>

            {/* Content type */}
            <div style={S.field}>
              <label style={S.label}>Content type</label>
              <select value={form.content_type} onChange={e => set('content_type', e.target.value)}>
                <option value="blog_post">Blog post</option>
                <option value="pillar_page">Pillar page</option>
                <option value="category_page">Category page</option>
                <option value="local_seo">Local SEO page</option>
              </select>
            </div>

            {/* Primary keyword */}
            <div style={S.field}>
              <label style={S.label}>Primary keyword</label>
              {form.client_id ? (
                <>
                  <select value={form.primary_keyword} onChange={e => {
                    if (e.target.value === '__new__') { setKwMode('primary') } else { set('primary_keyword', e.target.value); setKwMode(null) }
                  }}>
                    <option value="">Select keyword</option>
                    {keywords.map(k => <option key={k.id} value={k.keyword}>{k.keyword}{k.intent ? ` (${k.intent})` : ''}</option>)}
                    <option value="__new__">+ Add new keyword</option>
                  </select>
                  {kwMode === 'primary' && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <input value={newKw} onChange={e => setNewKw(e.target.value)} placeholder="New keyword" onKeyDown={e => e.key === 'Enter' && addNewKeyword(true)} style={{ flex: 1 }} />
                      <button style={{ ...S.btn, padding: '8px 14px', fontSize: 12 }} onClick={() => addNewKeyword(true)} disabled={addingKw}>Add</button>
                    </div>
                  )}
                </>
              ) : (
                <input value={form.primary_keyword} onChange={e => set('primary_keyword', e.target.value)} placeholder="Select a client first" disabled style={{ opacity: 0.5 }} />
              )}
            </div>

            {/* Supporting keywords */}
            <div style={S.field}>
              <label style={S.label}>Supporting keywords</label>
              {form.client_id && availableKeywords.length > 0 ? (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {availableKeywords.map(k => (
                      <button key={k.id} onClick={() => toggleSupporting(k.keyword)} style={{ padding: '5px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: 'none', background: form.supporting_keywords.includes(k.keyword) ? '#6366F1' : '#252836', color: form.supporting_keywords.includes(k.keyword) ? '#fff' : '#8B91A8', fontWeight: form.supporting_keywords.includes(k.keyword) ? 500 : 400 }}>
                        {k.keyword}
                      </button>
                    ))}
                    <button onClick={() => setKwMode(kwMode === 'supporting' ? null : 'supporting')} style={{ padding: '5px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: '1px dashed #252836', background: 'transparent', color: '#8B91A8' }}>+ New</button>
                  </div>
                  {kwMode === 'supporting' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input value={newKw} onChange={e => setNewKw(e.target.value)} placeholder="New keyword" onKeyDown={e => e.key === 'Enter' && addNewKeyword(false)} style={{ flex: 1 }} />
                      <button style={{ ...S.btn, padding: '8px 14px', fontSize: 12 }} onClick={() => addNewKeyword(false)} disabled={addingKw}>Add</button>
                    </div>
                  )}
                  {form.supporting_keywords.length > 0 && <div style={{ fontSize: 12, color: '#8B91A8', marginTop: 6 }}>Selected: {form.supporting_keywords.join(', ')}</div>}
                </>
              ) : (
                <div style={{ fontSize: 13, color: '#5A6070' }}>{form.client_id ? 'No other keywords in bank.' : 'Select a client first.'}</div>
              )}
            </div>

            {/* Brief */}
            <div style={S.field}>
              <label style={S.label}>Brief / angle</label>
              <textarea rows={2} value={form.title_brief} onChange={e => set('title_brief', e.target.value)} placeholder="Specific direction for this piece" />
            </div>

            {/* Internal links */}
            <div style={S.field}>
              <label style={S.label}>Internal links to include</label>
              <input value={form.internal_links} onChange={e => set('internal_links', e.target.value)} placeholder="e.g. /ear-wax-removal-newcastle" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24 }}>
              <div>
                <label style={S.label}>Word count</label>
                <input type="number" value={form.word_count} onChange={e => set('word_count', e.target.value)} />
              </div>
              <div>
                <label style={S.label}>Schedule for</label>
                <input type="datetime-local" value={form.scheduled_for} onChange={e => set('scheduled_for', e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button style={S.btn} onClick={save} disabled={saving || !form.client_id || !form.primary_keyword || !form.scheduled_for}>{saving ? 'Saving...' : 'Schedule task'}</button>
              <button style={{ ...S.btn, background: '#1C1F2A', color: '#8B91A8' }} onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
