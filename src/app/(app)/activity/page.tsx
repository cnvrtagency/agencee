'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AgentActivity } from '@/lib/types'
import Link from 'next/link'


function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

const ACTION_ICON: Record<string, string> = {
  scheduled_run: '⏱',
  keyword_suggestion: '🔍',
  content_plan: '📅',
  competitor_analysis: '🔎',
  write_file: '✏️',
  publish: '🚀',
  approve: '✓',
}

const COST_PER_TOKEN = 4 / 1_000_000

function tokensToCost(t: number) {
  const c = t * COST_PER_TOKEN
  return c < 0.01 ? '<$0.01' : `$${c.toFixed(2)}`
}

export default function ActivityPage() {
  const [activity, setActivity] = useState<(AgentActivity & { agents?: any; client_profiles?: any })[]>([])
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [clientFilter, setClientFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const PAGE_SIZE = 50

  useEffect(() => {
    supabase.from('client_profiles').select('id,name').order('name').then(({ data }) => setClients(data || []))
  }, [])

  useEffect(() => { setPage(0); load(0) }, [clientFilter])
  useEffect(() => { if (page > 0) load(page) }, [page])

  async function load(p: number) {
    const params = new URLSearchParams({ page: String(p), page_size: String(PAGE_SIZE) })
    if (clientFilter !== 'all') params.set('client_id', clientFilter)
    const res = await fetch(`/api/agent-activity?${params}`)
    const { data } = await res.json()
    if (p === 0) setActivity(data || [])
    else setActivity(prev => [...prev, ...(data || [])])
    setHasMore((data || []).length === PAGE_SIZE + 1)
  }

  // Group by day
  const grouped: Record<string, typeof activity> = {}
  for (const a of activity) {
    const day = new Date(a.created_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    if (!grouped[day]) grouped[day] = []
    grouped[day].push(a)
  }

  const totalTokens = activity.reduce((sum, a) => sum + (a.tokens_used || 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 36 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.5px' }}>Activity log</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Full audit trail of everything your agents have done.</p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {activity.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
              {activity.length} entries · {tokensToCost(totalTokens)} spend
            </div>
          )}
          <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: 99, fontSize: 12, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer' }}>
            <option value="all">All clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {activity.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '64px 20px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>No activity yet</div>
          <p style={{ fontSize: 13, color: 'var(--text-2)' }}>Once agents start working, every action is logged here.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([day, items]) => (
          <div key={day} style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>{day}</div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>
              {items.map((a, i) => (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                  padding: '14px 20px',
                  borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  {/* Timeline dot */}
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>{a.action.replace(/_/g, ' ')}</span>
                      {(a as any).agents?.name && (
                        <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>{(a as any).agents.name}</span>
                      )}
                      {(a as any).client_profiles?.name && (
                        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{(a as any).client_profiles.name}</span>
                      )}
                    </div>
                    {a.detail && (
                      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 }}>{a.detail}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{timeAgo(a.created_at)}</span>
                    {a.tokens_used > 0 && (
                      <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{a.tokens_used.toLocaleString()} tok</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {hasMore && (
        <button onClick={() => setPage(p => p + 1)} style={{ display: 'block', width: '100%', padding: '12px', textAlign: 'center', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', fontSize: 13, color: 'var(--text-2)', cursor: 'pointer', marginTop: 8 }}>
          Load more
        </button>
      )}
    </div>
  )
}
