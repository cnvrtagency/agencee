'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const COST_PER_TOKEN = 4 / 1_000_000

const S: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 20 },
  dayHead: { padding: '10px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' },
  row: { display: 'flex', gap: 14, alignItems: 'flex-start', padding: '12px 16px', borderBottom: '1px solid var(--border)' },
  dot: { width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, marginTop: 5 },
  action: { fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: 2 },
  detail: { fontSize: 13, color: 'var(--text)', lineHeight: 1.5 },
  meta: { fontSize: 11, color: 'var(--text-2)', marginTop: 3 },
}

export default function AgentActivityPage() {
  const { id: agentId } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<{ name: string } | null>(null)
  const [activity, setActivity] = useState<any[]>([])
  const [page, setPage] = useState(0)
  const [totalTokens, setTotalTokens] = useState(0)
  const PAGE_SIZE = 50

  useEffect(() => {
    supabase.from('agents').select('name').eq('id', agentId).single().then(({ data }) => setAgent(data))
  }, [agentId])

  useEffect(() => { load() }, [agentId, page])

  async function load() {
    const params = new URLSearchParams({ agent_id: agentId, page: String(page), page_size: String(PAGE_SIZE) })
    const res = await fetch(`/api/agent-activity?${params}`)
    const { data } = await res.json()
    setActivity(data || [])
    if (page === 0) {
      const totalsRes = await fetch(`/api/agent-activity?agent_id=${agentId}&totals_only=true`)
      const { data: totals } = await totalsRes.json()
      const sum = (totals || []).reduce((acc: number, r: any) => acc + (r.tokens_used || 0), 0)
      setTotalTokens(sum)
    }
  }

  // Group by day
  const byDay: Record<string, any[]> = {}
  activity.forEach(a => {
    const day = new Date(a.created_at).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(a)
  })

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{agent?.name ?? '...'}</div>
        <h1 style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.5px' }}>Activity</h1>
        {totalTokens > 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            {totalTokens.toLocaleString()} tokens used all-time · estimated cost <span style={{ fontFamily: 'var(--font-mono)' }}>${(totalTokens * COST_PER_TOKEN).toFixed(2)}</span>
          </p>
        )}
      </div>

      {Object.keys(byDay).length === 0 && (
        <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>
          No activity recorded yet.
        </div>
      )}

      {Object.entries(byDay).map(([day, rows]) => (
        <div key={day} style={S.panel}>
          <div style={S.dayHead}>{day}</div>
          {rows.map((a, i) => (
            <div key={a.id} style={{ ...S.row, borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={S.dot} />
              <div style={{ flex: 1 }}>
                <div style={S.action}>{a.action.replace(/_/g, ' ')}</div>
                <div style={S.detail}>{a.detail || '—'}</div>
                <div style={S.meta}>
                  {a.client_profiles?.name && <span>{a.client_profiles.name} · </span>}
                  {a.tokens_used > 0 && <span style={{ fontFamily: 'var(--font-mono)' }}>{a.tokens_used.toLocaleString()} tokens</span>}
                  {' · '}
                  {new Date(a.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 8 }}>
        {page > 0 && (
          <button onClick={() => setPage(p => p - 1)} style={{ padding: '7px 18px', borderRadius: 8, fontSize: 13, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer' }}>
            ← Previous
          </button>
        )}
        {activity.length === PAGE_SIZE && (
          <button onClick={() => setPage(p => p + 1)} style={{ padding: '7px 18px', borderRadius: 8, fontSize: 13, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer' }}>
            Next →
          </button>
        )}
      </div>
    </div>
  )
}
