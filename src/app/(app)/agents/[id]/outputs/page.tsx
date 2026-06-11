'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const S: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '11px 16px', borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 16px', fontSize: 13, verticalAlign: 'top' as const },
}

function pill(active: boolean): React.CSSProperties {
  return { padding: '5px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: 'none', background: active ? 'var(--accent)' : 'var(--surface-2)', color: active ? '#fff' : 'var(--text-2)', fontWeight: active ? 600 : 400 }
}

export default function AgentOutputsPage() {
  const { id: agentId } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<{ name: string } | null>(null)
  const [outputs, setOutputs] = useState<any[]>([])
  const [filter, setFilter] = useState<'pending' | 'approved'>('pending')

  useEffect(() => {
    supabase.from('agents').select('name').eq('id', agentId).single().then(({ data }) => setAgent(data))
  }, [agentId])

  useEffect(() => { load() }, [filter])

  async function load() {
    const { data } = await supabase
      .from('content_outputs')
      .select('*, client_profiles(name)')
      .eq('approved', filter === 'approved')
      .order('created_at', { ascending: false })
      .limit(100)
    setOutputs(data || [])
  }

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{agent?.name ?? '...'}</div>
        <h1 style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.5px' }}>Outputs</h1>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {(['pending', 'approved'] as const).map(f => (
          <button key={f} style={pill(filter === f)} onClick={() => setFilter(f)}>
            {f === 'pending' ? 'Needs review' : 'Approved'}
          </button>
        ))}
      </div>

      <div style={S.panel}>
        {outputs.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>
            No {filter === 'pending' ? 'drafts waiting for review' : 'approved outputs'}.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Title', 'Client', 'Keyword', 'Words', 'Date'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {outputs.map((o, i) => (
                <tr key={o.id}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  style={{ borderBottom: i < outputs.length - 1 ? '1px solid var(--border)' : 'none' }}
                >
                  <td style={{ ...S.td, maxWidth: 280 }}>
                    <Link href={`/outputs/${o.id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
                      {o.title || 'Untitled'}
                    </Link>
                  </td>
                  <td style={{ ...S.td, color: 'var(--text-2)' }}>{o.client_profiles?.name || '—'}</td>
                  <td style={{ ...S.td, color: 'var(--text-2)', fontSize: 12 }}>{o.primary_keyword || '—'}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{o.word_count?.toLocaleString() || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                    {new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
