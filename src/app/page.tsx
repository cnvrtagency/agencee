'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import StatusBadge from '@/components/StatusBadge'
import Link from 'next/link'

const S = {
  h1: { fontSize: 26, fontWeight: 600, color: '#E2E4EE', marginBottom: 4 } as React.CSSProperties,
  sub: { fontSize: 14, color: '#8B91A8', marginBottom: 32 } as React.CSSProperties,
  grid: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 36 } as React.CSSProperties,
  statCard: { background: '#141720', border: '1px solid #252836', borderRadius: 10, padding: '20px 24px' } as React.CSSProperties,
  statNum: { fontFamily: '"JetBrains Mono",monospace', fontSize: 32, fontWeight: 500, color: '#E2E4EE', lineHeight: 1 } as React.CSSProperties,
  statLabel: { fontSize: 12, color: '#8B91A8', marginTop: 8, textTransform: 'uppercase' as const, letterSpacing: '0.8px' },
  cols: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 } as React.CSSProperties,
  panel: { background: '#141720', border: '1px solid #252836', borderRadius: 10, overflow: 'hidden' } as React.CSSProperties,
  panelHead: { padding: '14px 20px', borderBottom: '1px solid #252836', fontSize: 12, fontWeight: 600, color: '#8B91A8', textTransform: 'uppercase' as const, letterSpacing: '1px' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #1C1F2A', fontSize: 14 } as React.CSSProperties,
  empty: { padding: '32px 20px', fontSize: 14, color: '#8B91A8', textAlign: 'center' as const },
}

export default function Dashboard() {
  const [stats, setStats] = useState({ queued: 0, running: 0, review: 0, clients: 0 })
  const [outputs, setOutputs] = useState<any[]>([])
  const [queue, setQueue] = useState<any[]>([])

  useEffect(() => {
    async function load() {
      const [{ data: queueData }, { data: outputData }, { count: clientCount }] = await Promise.all([
        supabase.from('content_queue').select('*, client_profiles(name)').order('created_at', { ascending: false }).limit(6),
        supabase.from('content_outputs').select('*, client_profiles(name)').eq('approved', false).order('created_at', { ascending: false }).limit(6),
        supabase.from('client_profiles').select('*', { count: 'exact', head: true }),
      ])
      const q = queueData || []
      setStats({
        queued: q.filter((i: any) => i.status === 'queued').length,
        running: q.filter((i: any) => i.status === 'running').length,
        review: (outputData || []).length,
        clients: clientCount || 0,
      })
      setOutputs(outputData || [])
      setQueue(q)
    }
    load()
  }, [])

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  return (
    <div>
      <h1 style={S.h1}>Dashboard</h1>
      <p style={S.sub}>Your agents are running. Here is what needs your attention.</p>

      <div style={S.grid}>
        {[
          { num: stats.clients, label: 'Clients' },
          { num: stats.queued,  label: 'Queued' },
          { num: stats.running, label: 'Running' },
          { num: stats.review,  label: 'Needs review' },
        ].map(({ num, label }) => (
          <div key={label} style={S.statCard}>
            <div style={S.statNum}>{num}</div>
            <div style={S.statLabel}>{label}</div>
          </div>
        ))}
      </div>

      <div style={S.cols}>
        <div style={S.panel}>
          <div style={S.panelHead}>Pending review</div>
          {outputs.length === 0
            ? <div style={S.empty}>Nothing waiting for review.</div>
            : outputs.map((o: any) => (
              <Link key={o.id} href={`/outputs/${o.id}`} style={{ ...S.row, textDecoration: 'none', color: 'inherit' }}>
                <div>
                  <div style={{ color: '#E2E4EE', marginBottom: 2 }}>{o.title || o.primary_keyword}</div>
                  <div style={{ fontSize: 12, color: '#8B91A8' }}>{o.client_profiles?.name} · {fmt(o.created_at)}</div>
                </div>
                <span style={{ fontSize: 12, color: '#6366F1', fontWeight: 500 }}>Review →</span>
              </Link>
            ))
          }
        </div>

        <div style={S.panel}>
          <div style={S.panelHead}>Queue activity</div>
          {queue.length === 0
            ? <div style={S.empty}>No tasks scheduled yet.</div>
            : queue.map((q: any) => (
              <div key={q.id} style={S.row}>
                <div>
                  <div style={{ color: '#E2E4EE', marginBottom: 2 }}>{q.primary_keyword}</div>
                  <div style={{ fontSize: 12, color: '#8B91A8' }}>{q.client_profiles?.name} · {fmt(q.scheduled_for)}</div>
                </div>
                <StatusBadge status={q.status} />
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}
