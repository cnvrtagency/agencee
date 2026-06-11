'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { QueueItem, Client } from '@/lib/types'
import StatusBadge from '@/components/StatusBadge'

type Keyword = { id: string; keyword: string; cluster: string | null; intent: string | null; funnel_stage: string | null }
type PlannedTask = { id: string; client_id: string; content_type: string; primary_keyword: string; supporting_keywords: string[]; title_brief: string; word_count: number; internal_links: string; notes: string; status: string; agent_id: string; agents?: { name: string; role: string } }

const blank = { client_id: '', agent_id: '', content_type: 'blog_post', primary_keyword: '', supporting_keywords: [] as string[], title_brief: '', word_count: '1200', scheduled_for: '', internal_links: '', notes: '' }

const btnPrimary: React.CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)',
  padding: '9px 20px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', transition: 'background 0.15s',
}
const btnSecondary: React.CSSProperties = {
  background: 'var(--surface-3)', color: 'var(--text-2)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', padding: '9px 18px', fontSize: 13.5, cursor: 'pointer',
}
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6,
  display: 'block', textTransform: 'uppercase', letterSpacing: '0.8px',
}

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
  const [sitePages, setSitePages] = useState<{ url: string; title: string | null }[]>([])
  const [selectedLinks, setSelectedLinks] = useState<string[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [workerStale, setWorkerStale] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
    load()
  }, [])
  useEffect(() => {
    if (form.client_id) { loadKeywords(form.client_id); loadSitePages(form.client_id) }
  }, [form.client_id])

  async function load() {
    const [{ data: q }, { data: c }, { data: a }, { data: p }] = await Promise.all([
      supabase.from('content_queue').select('*, client_profiles(name)').order('scheduled_for', { ascending: false }).limit(50),
      supabase.from('client_profiles').select('id,name,slug,industry,website,description,icp,usp,brand_voice,content_goals,competitors,github_repo').order('name'),
      supabase.from('agents').select('id,name,role').order('name'),
      supabase.from('planned_tasks').select('*, agents(name,role)').neq('status', 'scheduled').order('created_at', { ascending: false }),
    ])
    setItems(q || [])
    setClients((c || []) as unknown as Client[])
    setAgents(a || [])
    setPlannedTasks(p || [])
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    setWorkerStale((q || []).some((i: any) => (i.status === 'queued' || i.status === 'running') && i.created_at < thirtyMinAgo))
  }

  async function runNow(itemId: string) {
    setRunningId(itemId); setRunError(null)
    try {
      const res = await fetch('/api/run-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queue_item_id: itemId }) })
      const data = await res.json()
      if (!res.ok || !data.success) { setRunError(data.error || 'Task failed'); setRunningId(null); return }
      load()
    } catch (e: any) { setRunError(e.message || 'Something went wrong') }
    setRunningId(null)
  }

  async function loadKeywords(clientId: string) {
    const { data } = await supabase.from('keyword_banks').select('id,keyword,cluster,intent,funnel_stage').eq('client_id', clientId).order('priority')
    setKeywords(data || [])
  }

  async function loadSitePages(clientId: string) {
    const { data } = await supabase.from('site_pages').select('url,title').eq('client_id', clientId).order('url').limit(200)
    setSitePages(data || [])
    setSelectedLinks([])
  }

  function toggleLink(url: string) { setSelectedLinks(prev => prev.includes(url) ? prev.filter(u => u !== url) : [...prev, url]) }
  function set(k: string, v: any) { setForm(f => ({ ...f, [k]: v })) }
  function toggleSupporting(kw: string) {
    setForm(f => ({ ...f, supporting_keywords: f.supporting_keywords.includes(kw) ? f.supporting_keywords.filter(k => k !== kw) : [...f.supporting_keywords, kw] }))
  }

  async function addNewKeyword(forPrimary: boolean) {
    if (!newKw.trim() || !form.client_id) return
    setAddingKw(true)
    await supabase.from('keyword_banks').insert({ client_id: form.client_id, keyword: newKw.trim(), priority: 5 })
    if (forPrimary) set('primary_keyword', newKw.trim()); else toggleSupporting(newKw.trim())
    setNewKw(''); setKwMode(null); setAddingKw(false); loadKeywords(form.client_id)
  }

  function fillFromPlanned(task: PlannedTask) {
    setForm({
      client_id: task.client_id, agent_id: task.agent_id, content_type: task.content_type,
      primary_keyword: task.primary_keyword, supporting_keywords: task.supporting_keywords || [],
      title_brief: task.title_brief || '', word_count: String(task.word_count || 1200),
      scheduled_for: '', internal_links: task.internal_links || '', notes: task.notes || '',
    })
    if (task.internal_links) setSelectedLinks(task.internal_links.split('\n').filter(Boolean))
    ;(window as any).__plannedTaskId = task.id
  }

  async function save() {
    if (!form.client_id || !form.primary_keyword || !form.scheduled_for) return
    setSaving(true)
    await supabase.from('content_queue').insert({
      client_id: form.client_id, user_id: userId,
      agent_type: agents.find(a => a.id === form.agent_id)?.role?.toLowerCase().replace(/\s+/g, '_') || 'seo',
      content_type: form.content_type, primary_keyword: form.primary_keyword,
      supporting_keywords: form.supporting_keywords, title_brief: form.title_brief || null,
      word_count: parseInt(form.word_count) || 1200, scheduled_for: new Date(form.scheduled_for).toISOString(), status: 'queued',
    })
    const plannedId = (window as any).__plannedTaskId
    if (plannedId) { await supabase.from('planned_tasks').update({ status: 'scheduled' }).eq('id', plannedId); delete (window as any).__plannedTaskId }
    setSaving(false); setOpen(false); setForm(blank); load()
  }

  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter)
  const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const availableKeywords = keywords.filter(k => k.keyword !== form.primary_keyword)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 36 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.5px' }}>Queue</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Scheduled tasks are picked up automatically. Use "Run now" to trigger immediately.</p>
        </div>
        <button style={{ ...btnPrimary, padding: '10px 22px', fontSize: 14 }} onClick={() => { setOpen(true); delete (window as any).__plannedTaskId }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent)')}
        >Schedule task</button>
      </div>

      {workerStale && (
        <div style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 'var(--radius-md)', padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--amber)', marginBottom: 3 }}>Worker appears offline</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Tasks have been queued for over 30 minutes. Use "Run now" to execute a task manually.</div>
          </div>
        </div>
      )}

      {runError && (
        <div style={{ background: 'var(--red-bg)', border: '1px solid rgba(242,107,107,0.3)', borderRadius: 'var(--radius-md)', padding: '12px 18px', marginBottom: 20, fontSize: 13, color: 'var(--red)' }}>
          Run error: {runError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {['all', 'queued', 'running', 'review', 'done', 'failed'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '6px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: 'none',
            background: filter === f ? 'var(--accent)' : 'var(--surface-2)',
            color: filter === f ? '#fff' : 'var(--text-2)',
            fontWeight: filter === f ? 600 : 400, textTransform: 'capitalize', letterSpacing: '0.3px',
          }}>{f}</button>
        ))}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
              {filter === 'all' ? 'No tasks scheduled yet.' : `No ${filter} tasks.`}
            </div>
            {filter === 'all' && <button style={btnPrimary} onClick={() => { setOpen(true); delete (window as any).__plannedTaskId }}>Schedule your first task</button>}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Keyword', 'Client', 'Type', 'Scheduled', 'Status', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px', padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => (
                <tr key={item.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '14px 18px', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{item.primary_keyword}</td>
                  <td style={{ padding: '14px 18px', fontSize: 13, color: 'var(--text-2)' }}>{(item.client_profiles as any)?.name || '—'}</td>
                  <td style={{ padding: '14px 18px', fontSize: 12, color: 'var(--text-2)', textTransform: 'capitalize' }}>{item.content_type?.replace('_', ' ')}</td>
                  <td style={{ padding: '14px 18px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{fmt(item.scheduled_for)}</td>
                  <td style={{ padding: '14px 18px' }}>
                    <StatusBadge status={item.status} error={(item as any).error_message} />
                  </td>
                  <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                    {(item.status === 'queued' || item.status === 'failed') && (
                      <button onClick={() => runNow(item.id)} disabled={runningId === item.id} style={{
                        padding: '5px 14px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 500,
                        cursor: runningId === item.id ? 'default' : 'pointer',
                        border: '1px solid var(--border)', background: 'var(--surface-2)',
                        color: runningId === item.id ? 'var(--text-2)' : 'var(--accent)',
                        opacity: runningId === item.id ? 0.6 : 1, transition: 'border-color 0.15s',
                      }}
                        onMouseEnter={e => !runningId && (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                      >{runningId === item.id ? 'Running...' : 'Run now'}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setOpen(false)}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 32, width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 6, color: 'var(--text)', letterSpacing: '-0.3px' }}>Schedule a task</h2>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 24 }}>The worker picks this up at the scheduled time.</p>

            {plannedTasks.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 12 }}>Planned by your agents</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                  {plannedTasks.map(t => {
                    const client = clients.find(c => c.id === t.client_id)
                    return (
                      <div key={t.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.12s' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                        onClick={() => fillFromPlanned(t)}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>{t.primary_keyword}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                              {client?.name} · {t.content_type.replace(/_/g, ' ')}
                              {t.agents && <span style={{ color: 'var(--accent)' }}> · {(t.agents as any).name}</span>}
                            </div>
                            {t.title_brief && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, fontStyle: 'italic' }}>{t.title_brief}</div>}
                          </div>
                          <span style={{ fontSize: 10, color: t.status === 'ready' ? 'var(--green)' : 'var(--amber)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0, marginLeft: 12 }}>{t.status}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 10 }}>Click a planned task to pre-fill the form below.</div>
                <div style={{ borderBottom: '1px solid var(--border)', marginTop: 20, marginBottom: 20 }} />
              </div>
            )}

            {/* Form fields */}
            {[
              { key: 'client_id', label: 'Client', el: (
                <select value={form.client_id} onChange={e => { set('client_id', e.target.value); set('primary_keyword', ''); set('supporting_keywords', []) }}>
                  <option value="">Select client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )},
              { key: 'agent_id', label: 'Agent', el: (
                <select value={form.agent_id} onChange={e => set('agent_id', e.target.value)}>
                  <option value="">Select agent</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
                </select>
              )},
              { key: 'content_type', label: 'Content type', el: (
                <select value={form.content_type} onChange={e => set('content_type', e.target.value)}>
                  <option value="blog_post">Blog post</option>
                  <option value="pillar_page">Pillar page</option>
                  <option value="category_page">Category page</option>
                  <option value="local_seo">Local SEO page</option>
                </select>
              )},
            ].map(({ key, label: lbl, el }) => (
              <div key={key} style={{ marginBottom: 18 }}>
                <label style={labelStyle}>{lbl}</label>
                {el}
              </div>
            ))}

            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Primary keyword</label>
              {form.client_id ? (
                <>
                  <select value={form.primary_keyword} onChange={e => { if (e.target.value === '__new__') setKwMode('primary'); else { set('primary_keyword', e.target.value); setKwMode(null) } }}>
                    <option value="">Select keyword</option>
                    {keywords.map(k => <option key={k.id} value={k.keyword}>{k.keyword}{k.intent ? ` (${k.intent})` : ''}</option>)}
                    <option value="__new__">+ Add new keyword</option>
                  </select>
                  {kwMode === 'primary' && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <input value={newKw} onChange={e => setNewKw(e.target.value)} placeholder="New keyword" onKeyDown={e => e.key === 'Enter' && addNewKeyword(true)} style={{ flex: 1 }} />
                      <button style={btnPrimary} onClick={() => addNewKeyword(true)} disabled={addingKw}>Add</button>
                    </div>
                  )}
                </>
              ) : (
                <input value={form.primary_keyword} onChange={e => set('primary_keyword', e.target.value)} placeholder="Select a client first" disabled style={{ opacity: 0.5 }} />
              )}
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Supporting keywords</label>
              {form.client_id && availableKeywords.length > 0 ? (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {availableKeywords.map(k => (
                      <button key={k.id} onClick={() => toggleSupporting(k.keyword)} style={{ padding: '5px 10px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: 'none', background: form.supporting_keywords.includes(k.keyword) ? 'var(--accent)' : 'var(--surface-3)', color: form.supporting_keywords.includes(k.keyword) ? '#fff' : 'var(--text-2)', fontWeight: form.supporting_keywords.includes(k.keyword) ? 600 : 400 }}>
                        {k.keyword}
                      </button>
                    ))}
                    <button onClick={() => setKwMode(kwMode === 'supporting' ? null : 'supporting')} style={{ padding: '5px 10px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-2)' }}>+ New</button>
                  </div>
                  {kwMode === 'supporting' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input value={newKw} onChange={e => setNewKw(e.target.value)} placeholder="New keyword" onKeyDown={e => e.key === 'Enter' && addNewKeyword(false)} style={{ flex: 1 }} />
                      <button style={btnPrimary} onClick={() => addNewKeyword(false)} disabled={addingKw}>Add</button>
                    </div>
                  )}
                  {form.supporting_keywords.length > 0 && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>Selected: {form.supporting_keywords.join(', ')}</div>}
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{form.client_id ? 'No other keywords in bank.' : 'Select a client first.'}</div>
              )}
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Brief / angle</label>
              <textarea rows={2} value={form.title_brief} onChange={e => set('title_brief', e.target.value)} placeholder="Specific direction for this piece" />
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Internal links to include</label>
              {sitePages.length > 0 ? (
                <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', maxHeight: 180, overflowY: 'auto', background: 'var(--bg)' }}>
                  {sitePages.map(p => {
                    const path = p.url.replace(/^https?:\/\/[^/]+/, '') || '/'
                    const checked = selectedLinks.includes(p.url)
                    return (
                      <label key={p.url} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: checked ? 'var(--accent-bg)' : 'transparent' }}
                        onClick={() => { toggleLink(p.url); const next = selectedLinks.includes(p.url) ? selectedLinks.filter(u => u !== p.url) : [...selectedLinks, p.url]; set('internal_links', next.join('\n')) }}>
                        <div style={{ width: 15, height: 15, borderRadius: 4, border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-bright)'}`, background: checked ? 'var(--accent)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {checked && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                        </div>
                        <span style={{ fontSize: 12, color: checked ? 'var(--text)' : 'var(--text-2)', fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</span>
                        {p.title && <span style={{ fontSize: 11, color: 'var(--text-dim)', flexShrink: 0, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>}
                      </label>
                    )
                  })}
                </div>
              ) : (
                <input value={form.internal_links} onChange={e => set('internal_links', e.target.value)} placeholder={form.client_id ? 'No pages crawled yet' : 'Select a client first'} disabled={!form.client_id} />
              )}
              {selectedLinks.length > 0 && <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 5 }}>{selectedLinks.length} page{selectedLinks.length > 1 ? 's' : ''} selected</div>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24 }}>
              <div>
                <label style={labelStyle}>Word count</label>
                <input type="number" value={form.word_count} onChange={e => set('word_count', e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Schedule for</label>
                <input type="datetime-local" value={form.scheduled_for} onChange={e => set('scheduled_for', e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button style={btnPrimary} onClick={save} disabled={saving || !form.client_id || !form.primary_keyword || !form.scheduled_for}
                onMouseEnter={e => !saving && (e.currentTarget.style.background = 'var(--accent-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent)')}
              >{saving ? 'Saving...' : 'Schedule task'}</button>
              <button style={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
