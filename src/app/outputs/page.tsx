'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Output } from '@/lib/types'
import Link from 'next/link'

const S = {
  h1: { fontSize: 26, fontWeight: 600, color: '#E2E4EE', marginBottom: 4 } as React.CSSProperties,
  sub: { fontSize: 14, color: '#8B91A8', marginBottom: 32 } as React.CSSProperties,
  panel: { background: '#141720', border: '1px solid #252836', borderRadius: 10, overflow: 'hidden' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#8B91A8', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '12px 16px', borderBottom: '1px solid #252836' },
  td: { padding: '14px 16px', fontSize: 14, borderBottom: '1px solid #1C1F2A', verticalAlign: 'middle' as const },
}

export default function OutputsPage() {
  const [outputs, setOutputs] = useState<Output[]>([])
  const [filter, setFilter] = useState<'pending' | 'approved'>('pending')

  useEffect(() => { load() }, [filter])

  async function load() {
    const { data } = await supabase
      .from('content_outputs')
      .select('*, client_profiles(name)')
      .eq('approved', filter === 'approved')
      .order('created_at', { ascending: false })
      .limit(50)
    setOutputs(data || [])
  }

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div>
      <h1 style={S.h1}>Outputs</h1>
      <p style={S.sub}>Drafts your agents have produced. Review and approve before publishing.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['pending', 'approved'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '6px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer', border: 'none',
            background: filter === f ? '#6366F1' : '#1C1F2A',
            color: filter === f ? '#fff' : '#8B91A8',
            fontWeight: filter === f ? 500 : 400,
            textTransform: 'capitalize',
          }}>{f === 'pending' ? 'Needs review' : 'Approved'}</button>
        ))}
      </div>

      <div style={S.panel}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Title</th>
              <th style={S.th}>Client</th>
              <th style={S.th}>Keyword</th>
              <th style={{ ...S.th, textAlign: 'right' as const }}>Words</th>
              <th style={S.th}>Date</th>
              <th style={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {outputs.map(o => (
              <tr key={o.id}>
                <td style={{ ...S.td, color: '#E2E4EE', fontWeight: 500, maxWidth: 280 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.title || o.primary_keyword || 'Untitled'}
                  </div>
                </td>
                <td style={{ ...S.td, color: '#8B91A8' }}>{(o.client_profiles as any)?.name || '—'}</td>
                <td style={{ ...S.td, color: '#8B91A8', fontSize: 13 }}>{o.primary_keyword || '—'}</td>
                <td style={{ ...S.td, color: '#8B91A8', textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>{o.word_count?.toLocaleString() || '—'}</td>
                <td style={{ ...S.td, color: '#8B91A8', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>{fmt(o.created_at)}</td>
                <td style={S.td}>
                  <Link href={`/outputs/${o.id}`} style={{ color: '#6366F1', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
                    {filter === 'pending' ? 'Review →' : 'View →'}
                  </Link>
                </td>
              </tr>
            ))}
            {outputs.length === 0 && (
              <tr><td colSpan={6} style={{ ...S.td, color: '#8B91A8', textAlign: 'center', padding: '40px 16px' }}>
                {filter === 'pending' ? 'Nothing waiting for review.' : 'No approved outputs yet.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
