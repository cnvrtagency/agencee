'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { KeywordSuggestion } from '@/lib/types'

const intentColor: Record<string, string> = {
  informational: 'var(--accent)',
  commercial: 'var(--amber)',
  transactional: 'var(--green)',
  navigational: 'var(--text-2)',
}

const S: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', marginBottom: 24 },
  panelHead: { padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1.2px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '12px 18px', borderBottom: '1px solid var(--border)' },
  td: { padding: '13px 18px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top' as const },
}

function pill(active: boolean, color = 'var(--brand-bg)'): React.CSSProperties {
  return {
    padding: '5px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: 'none',
    background: active ? color : 'var(--surface-2)',
    color: active ? '#fff' : 'var(--text-2)',
    fontWeight: active ? 600 : 400,
  }
}

export default function KeywordsPage() {
  const [suggestions, setSuggestions] = useState<(KeywordSuggestion & { client_profiles?: any })[]>([])
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [acting, setActing] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('client_profiles').select('id,name').order('name').then(({ data }) => setClients(data || []))
  }, [])

  useEffect(() => { load() }, [filter, clientFilter])

  async function load() {
    let q = supabase
      .from('keyword_suggestions')
      .select('*, client_profiles(name)')
      .eq('status', filter)
      .order('created_at', { ascending: false })
    if (clientFilter !== 'all') q = q.eq('client_id', clientFilter) as any
    const { data } = await q
    setSuggestions(data || [])
  }

  async function act(id: string, status: 'approved' | 'rejected') {
    setActing(id)
    await supabase.from('keyword_suggestions').update({ status }).eq('id', id)
    if (status === 'approved') {
      const s = suggestions.find(x => x.id === id)
      if (s) {
        await supabase.from('keyword_banks').insert({
          client_id: s.client_id,
          keyword: s.keyword,
          cluster: s.cluster || null,
          intent: s.intent || 'informational',
          funnel_stage: s.funnel_stage || 'tofu',
          monthly_volume: s.monthly_volume_estimate || null,
          difficulty: s.difficulty_estimate || null,
          priority: 5,
        })
      }
    }
    setActing(null)
    load()
  }

  const pending = suggestions.filter(s => s.status === 'pending')

  return (
    <div>
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.5px' }}>Keyword suggestions</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Ada proposes keywords based on your clients' content gaps and competitive landscape. Approve to add to the keyword bank.</p>
      </div>

      {/* Filters */}
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
        <div style={S.panelHead}>
          <span>{filter.charAt(0).toUpperCase() + filter.slice(1)} keywords ({suggestions.length})</span>
          {filter === 'pending' && suggestions.length > 0 && (
            <button onClick={async () => {
              for (const s of pending) await act(s.id, 'approved')
            }} style={{ fontSize: 12, padding: '5px 14px', borderRadius: 99, background: 'var(--green)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              Approve all ({pending.length})
            </button>
          )}
        </div>

        {suggestions.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>
            {filter === 'pending'
              ? 'No pending suggestions. Ask Ada to suggest keywords for a client in the chat.'
              : filter === 'approved'
              ? 'No approved suggestions yet.'
              : 'No rejected suggestions.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Keyword', 'Client', 'Intent', 'Stage', 'Vol est.', 'KD est.', 'Rationale', ''].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s, i) => (
                <tr key={s.id}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  style={{ borderBottom: i < suggestions.length - 1 ? '1px solid var(--border)' : 'none' }}
                >
                  <td style={{ ...S.td, fontWeight: 600, color: 'var(--text)' }}>{s.keyword}</td>
                  <td style={{ ...S.td, color: 'var(--text-2)' }}>{(s as any).client_profiles?.name || '—'}</td>
                  <td style={S.td}>
                    {s.intent && <span style={{ fontSize: 11, fontWeight: 600, color: intentColor[s.intent] || 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.intent}</span>}
                  </td>
                  <td style={{ ...S.td, color: 'var(--text-2)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>{s.funnel_stage || '—'}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{s.monthly_volume_estimate?.toLocaleString() || '—'}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{s.difficulty_estimate ?? '—'}</td>
                  <td style={{ ...S.td, color: 'var(--text-2)', fontSize: 12, maxWidth: 260 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.rationale || '—'}</div>
                  </td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    {filter === 'pending' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button disabled={acting === s.id} onClick={() => act(s.id, 'approved')} style={{ padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--green)', color: '#fff' }}>
                          Approve
                        </button>
                        <button disabled={acting === s.id} onClick={() => act(s.id, 'rejected')} style={{ padding: '4px 12px', borderRadius: 99, fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)' }}>
                          Reject
                        </button>
                      </div>
                    )}
                    {filter === 'approved' && (
                      <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>Added to bank</span>
                    )}
                    {filter === 'rejected' && (
                      <button onClick={() => act(s.id, 'approved')} style={{ padding: '4px 12px', borderRadius: 99, fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)' }}>
                        Restore
                      </button>
                    )}
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
