'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const STATUS_COLOR: Record<string, string> = {
  queued: 'var(--text-2)',
  running: 'var(--accent)',
  review: 'var(--amber)',
  done: 'var(--green)',
  failed: 'var(--red)',
}

const S: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '11px 16px', borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 16px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top' as const },
}

export default function AgentQueuePage() {
  const { id: agentId } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<{ name: string } | null>(null)
  const [items, setItems] = useState<any[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('agents').select('name').eq('id', agentId).single().then(({ data }) => setAgent(data))
  }, [agentId])

  useEffect(() => { load() }, [agentId, filter])

  async function load() {
    let q = supabase
      .from('content_queue')
      .select('*, client_profiles(name)')
      .eq('agent_type', 'seo')
      .order('created_at', { ascending: false })
      .limit(100)
    if (filter !== 'all') q = q.eq('status', filter) as any
    const { data } = await q
    setItems(data || [])
  }

  async function clearQueue() {
    await supabase.from('content_queue').delete().in('status', ['queued', 'failed']).eq('agent_type', 'seo')
    setShowClearConfirm(false)
    load()
  }

  async function removeItem(id: string) {
    await supabase.from('content_queue').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
    setConfirmRemove(null)
  }

  const filters = ['all', 'queued', 'running', 'review', 'done', 'failed']

  return (
    <div>
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{agent?.name ?? '...'}</div>
          <h1 style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.5px' }}>Queue</h1>
        </div>
        <button onClick={() => setShowClearConfirm(true)} style={{ padding: '7px 16px', borderRadius: 'var(--radius)', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)' }}>
          Clear
        </button>
      </div>

      {showClearConfirm && (
        <div style={{ background: 'var(--amber-bg)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>Clear queue? Removes all queued/failed tasks. Running tasks unaffected.</span>
          <button onClick={clearQueue} style={{ padding: '5px 14px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--amber)', color: '#fff' }}>Clear</button>
          <button onClick={() => setShowClearConfirm(false)} style={{ padding: '5px 14px', borderRadius: 'var(--radius)', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)' }}>Cancel</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {filters.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '5px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: 'none',
            background: filter === f ? 'var(--accent)' : 'var(--surface-2)',
            color: filter === f ? '#fff' : 'var(--text-2)',
            fontWeight: filter === f ? 600 : 400,
          }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div style={S.panel}>
        {items.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>
            No queue items{filter !== 'all' ? ` with status "${filter}"` : ''}.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Status', 'Client', 'Keyword', 'Type', 'Words', 'Created', ''].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const isConfirming = confirmRemove === item.id
                return (
                  <tr key={item.id}
                    style={{ borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none', background: isConfirming ? 'var(--red-bg)' : 'transparent' }}
                    onMouseEnter={e => { if (!isConfirming) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
                    onMouseLeave={e => { if (!isConfirming) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    <td style={S.td}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[item.status] || 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {item.status}
                      </span>
                    </td>
                    <td style={{ ...S.td, color: 'var(--text-2)' }}>{(item as any).client_profiles?.name || '—'}</td>
                    <td style={{ ...S.td, fontWeight: 500, maxWidth: 220 }}>
                      {item.output_id
                        ? <Link href={`/outputs/${item.output_id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{item.primary_keyword}</Link>
                        : item.primary_keyword}
                    </td>
                    <td style={{ ...S.td, color: 'var(--text-2)', fontSize: 12 }}>{item.content_type}</td>
                    <td style={{ ...S.td, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{item.word_count?.toLocaleString()}</td>
                    <td style={{ ...S.td, fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                      {new Date(item.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                      {isConfirming ? (
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button onClick={() => removeItem(item.id)} style={{ padding: '3px 8px', borderRadius: 'var(--radius)', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--red)', color: '#fff' }}>Remove</button>
                          <button onClick={() => setConfirmRemove(null)} style={{ padding: '3px 6px', borderRadius: 'var(--radius)', fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', background: 'none', color: 'var(--text-2)' }}>Cancel</button>
                        </div>
                      ) : (
                        ['queued', 'failed'].includes(item.status) && (
                          <button onClick={() => setConfirmRemove(item.id)} style={{ padding: '2px 6px', borderRadius: 'var(--radius)', fontSize: 12, cursor: 'pointer', border: 'none', background: 'none', color: 'var(--text-dim)' }} title="Remove from queue">×</button>
                        )
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
