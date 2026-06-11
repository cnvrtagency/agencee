'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const S: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '11px 16px', borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 16px', fontSize: 13, verticalAlign: 'top' as const },
}

const sourceLabel: Record<string, { label: string; bg: string; color: string }> = {
  gsc_discovery: { label: 'GSC Discovery', bg: 'rgba(79,127,255,0.12)', color: 'var(--accent)' },
  ada: { label: 'Ada', bg: 'rgba(45,212,160,0.12)', color: 'var(--green)' },
  competitor_gap: { label: 'Competitor Gap', bg: 'rgba(139,92,246,0.12)', color: 'var(--purple)' },
}

function parseGscMeta(rationale: string): { position?: string; impressions?: string } {
  const pos = rationale.match(/Position (\d+)/)
  const imp = rationale.match(/(\d+) impressions/)
  return { position: pos?.[1], impressions: imp?.[1] }
}

const intentColor: Record<string, string> = {
  informational: 'var(--accent)',
  commercial: 'var(--amber)',
  transactional: 'var(--green)',
  navigational: 'var(--text-2)',
}

function pill(active: boolean): React.CSSProperties {
  return { padding: '5px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: 'none', background: active ? 'var(--accent)' : 'var(--surface-2)', color: active ? '#fff' : 'var(--text-2)', fontWeight: active ? 600 : 400 }
}

export default function AgentKeywordsPage() {
  const { id: agentId } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<{ name: string } | null>(null)
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set())
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [clientFilter, setClientFilter] = useState('all')
  const [acting, setActing] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkActing, setBulkActing] = useState<'approved' | 'rejected' | null>(null)

  useEffect(() => {
    supabase.from('agents').select('name').eq('id', agentId).single().then(({ data }) => setAgent(data))
    supabase.from('client_profiles').select('id,name').order('name').then(({ data }) => setClients(data || []))
  }, [agentId])

  useEffect(() => { load() }, [filter, clientFilter])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  function importanceScore(s: any): number {
    let score = 0
    const meta = s.metadata as any
    if (meta?.position) {
      if (meta.position <= 10) score += 50
      else if (meta.position <= 20) score += 35
      else score += 10
    }
    if (meta?.impressions) score += Math.min(meta.impressions / 10, 30)
    if (s.source === 'gsc_discovery') score += 20
    else if (s.source === 'competitor_gap') score += 10
    return score
  }

  function importanceStar(s: any): string {
    const score = importanceScore(s)
    if (score > 60) return '★★★'
    if (score > 30) return '★★'
    return '★'
  }

  async function load() {
    let q = supabase.from('keyword_suggestions').select('*, client_profiles(name)').eq('status', filter).order('created_at', { ascending: false })
    if (clientFilter !== 'all') q = q.eq('client_id', clientFilter) as any
    const { data } = await q
    const sorted = [...(data || [])].sort((a: any, b: any) => importanceScore(b) - importanceScore(a))
    setSuggestions(sorted)
    setSelectedIds(new Set())
  }

  function fadeOut(id: string, callback: () => void) {
    setFadingIds(prev => new Set([...prev, id]))
    setTimeout(() => {
      setSuggestions(prev => prev.filter(s => s.id !== id))
      setFadingIds(prev => { const n = new Set(prev); n.delete(id); return n })
      callback()
    }, 350)
  }

  async function reviewSuggestion(id: string, status: 'approved' | 'rejected') {
    const res = await fetch(status === 'approved' ? '/api/keywords/approve' : '/api/keywords/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestion_id: id, reason: '' }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `Failed to ${status === 'approved' ? 'approve' : 'reject'} keyword`)
  }

  async function approve(id: string) {
    const s = suggestions.find(x => x.id === id)
    setActing(id)
    try {
      await reviewSuggestion(id, 'approved')
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
      fadeOut(id, () => showToast(`"${s?.keyword}" added to keyword bank`))
    } catch (err: any) {
      console.error('Approve failed:', err.message)
      showToast(`Failed to approve: ${err.message}`)
    } finally {
      setActing(null)
    }
  }

  async function reject(id: string) {
    const s = suggestions.find(x => x.id === id)
    setActing(id)
    try {
      await reviewSuggestion(id, 'rejected')
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
      fadeOut(id, () => showToast(`"${s?.keyword}" rejected`))
    } catch (err: any) {
      console.error('Reject failed:', err.message)
      showToast(`Failed to reject: ${err.message}`)
    } finally {
      setActing(null)
    }
  }

  async function unreject(id: string) {
    await supabase.from('keyword_suggestions').update({ status: 'pending' }).eq('id', id)
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
    fadeOut(id, () => showToast('Keyword moved back to pending'))
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      const allSelected = suggestions.length > 0 && suggestions.every(s => next.has(s.id))
      for (const s of suggestions) {
        allSelected ? next.delete(s.id) : next.add(s.id)
      }
      return next
    })
  }

  const selectedVisible = suggestions.filter(s => selectedIds.has(s.id))
  const allVisibleSelected = suggestions.length > 0 && selectedVisible.length === suggestions.length

  async function bulkReview(status: 'approved' | 'rejected', rows?: typeof suggestions) {
    const targets = rows ?? selectedVisible
    if (targets.length === 0) return
    setBulkActing(status)
    const completed: string[] = []
    try {
      for (const s of targets) {
        try {
          await reviewSuggestion(s.id, status)
          completed.push(s.id)
        } catch (err: any) {
          console.error(`Bulk keyword ${status} failed:`, err.message)
        }
      }
      if (completed.length > 0) {
        setSuggestions(prev => prev.filter(s => !completed.includes(s.id)))
        setSelectedIds(new Set())
        showToast(`${completed.length} keyword${completed.length === 1 ? '' : 's'} ${status}`)
      } else {
        showToast(`No keywords ${status}`)
      }
    } finally {
      setBulkActing(null)
    }
  }

  async function approveAll() {
    await bulkReview('approved', suggestions)
  }

  return (
    <div>
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 16px', fontSize: 13, color: 'var(--text)', zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', transition: 'opacity 0.3s' }}>
          {toast}
        </div>
      )}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{agent?.name ?? '...'}</div>
        <h1 style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.5px' }}>Keyword Suggestions</h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>Review and approve keywords Ada has proposed.</p>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {(['pending', 'approved', 'rejected'] as const).map(f => (
          <button key={f} style={pill(filter === f)} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 6px' }} />
        <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
          style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer' }}>
          <option value="all">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div style={S.panel}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', justifyContent: 'space-between' }}>
          <span>{filter.charAt(0).toUpperCase() + filter.slice(1)} ({suggestions.length})</span>
          {filter === 'pending' && suggestions.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {selectedVisible.length > 0 ? (
                <>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'none', letterSpacing: 0 }}>{selectedVisible.length} selected</span>
                  <button disabled={bulkActing !== null} onClick={() => bulkReview('approved')}
                    style={{ fontSize: 11, padding: '4px 12px', borderRadius: 99, background: 'var(--green)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                    {bulkActing === 'approved' ? 'Approving...' : 'Approve selected'}
                  </button>
                  <button disabled={bulkActing !== null} onClick={() => bulkReview('rejected')}
                    style={{ fontSize: 11, padding: '4px 12px', borderRadius: 99, background: 'transparent', color: 'var(--red)', border: '1px solid rgba(242,107,107,0.35)', cursor: 'pointer', fontWeight: 600 }}>
                    {bulkActing === 'rejected' ? 'Rejecting...' : 'Reject selected'}
                  </button>
                </>
              ) : (
                <button onClick={approveAll}
                  style={{ fontSize: 11, padding: '4px 12px', borderRadius: 99, background: 'var(--green)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  Approve all
                </button>
              )}
            </div>
          )}
        </div>
        {suggestions.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>
            {filter === 'pending' ? 'No pending suggestions. Ask Ada to suggest keywords.' : `No ${filter} suggestions.`}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: 34, paddingRight: 4 }}>
                  {filter === 'pending' && (
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      aria-label={allVisibleSelected ? 'Clear selected keywords' : 'Select all visible keywords'}
                    />
                  )}
                </th>
                {['Keyword', 'Priority', 'Source', 'Client', 'Intent', 'Vol', 'KD', 'Rationale', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s, i) => {
                const src = sourceLabel[s.source] || null
                const gscMeta = s.source === 'gsc_discovery' ? parseGscMeta(s.rationale || '') : null
                const isFading = fadingIds.has(s.id)
                return (
                <tr key={s.id}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  style={{ borderBottom: i < suggestions.length - 1 ? '1px solid var(--border)' : 'none', transition: 'opacity 0.35s, transform 0.35s', opacity: isFading ? 0 : 1, transform: isFading ? 'translateX(-8px)' : 'none' }}
                >
                  <td style={{ ...S.td, width: 34, paddingRight: 4 }}>
                    {filter === 'pending' && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.id)}
                        onChange={() => toggleSelected(s.id)}
                        aria-label={`Select ${s.keyword}`}
                      />
                    )}
                  </td>
                  <td style={{ ...S.td, fontWeight: 600 }}>
                    {s.keyword}
                    {gscMeta?.position && <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>pos #{gscMeta.position}{gscMeta.impressions ? ` · ${gscMeta.impressions} imp` : ''}</div>}
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: importanceScore(s) > 60 ? 'var(--amber)' : importanceScore(s) > 30 ? 'var(--text-2)' : 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                    {importanceStar(s)}
                  </td>
                  <td style={S.td}>
                    {src
                      ? <span style={{ fontSize: 10, fontWeight: 600, color: src.color, background: src.bg, padding: '2px 7px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{src.label}</span>
                      : <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>—</span>
                    }
                  </td>
                  <td style={{ ...S.td, color: 'var(--text-2)' }}>{s.client_profiles?.name || '—'}</td>
                  <td style={S.td}>{s.intent && <span style={{ fontSize: 11, fontWeight: 600, color: intentColor[s.intent] || 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.intent}</span>}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{s.monthly_volume_estimate?.toLocaleString() || '—'}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{s.difficulty_estimate ?? '—'}</td>
                  <td style={{ ...S.td, color: 'var(--text-2)', fontSize: 12, maxWidth: 240 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.rationale || '—'}</div>
                  </td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    {filter === 'pending' && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <button disabled={acting === s.id} onClick={() => approve(s.id)} style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--green)', color: '#fff' }}>Approve ✓</button>
                        <button disabled={acting === s.id} onClick={() => reject(s.id)} style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)' }}>Reject</button>
                      </div>
                    )}
                    {filter === 'approved' && <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>In bank</span>}
                    {filter === 'rejected' && <button onClick={() => unreject(s.id)} style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)' }}>Un-reject</button>}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
