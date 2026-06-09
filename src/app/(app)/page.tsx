'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import StatusBadge from '@/components/StatusBadge'
import Link from 'next/link'

const S: Record<string, React.CSSProperties> = {
  statCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 8 },
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  panelHead: { padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '1.2px' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 20px', borderBottom: '1px solid rgba(255,255,255,0.03)' },
  empty: { padding: '40px 20px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' as const },
}

export default function Dashboard() {
  const [stats, setStats] = useState({ queued: 0, running: 0, review: 0, clients: 0 })
  const [outputs, setOutputs] = useState<any[]>([])
  const [queue, setQueue] = useState<any[]>([])
  const [usage, setUsage] = useState<{ used: number; budget: number } | null>(null)

  useEffect(() => {
    async function load() {
      const [{ data: queueData }, { data: outputData }, { count: clientCount }, { data: usageData }] = await Promise.all([
        supabase.from('content_queue').select('*, client_profiles(name)').order('created_at', { ascending: false }).limit(8),
        supabase.from('content_outputs').select('*, client_profiles(name)').eq('approved', false).order('created_at', { ascending: false }).limit(6),
        supabase.from('client_profiles').select('*', { count: 'exact', head: true }),
        supabase.from('workspace_settings').select('tokens_used_this_month,monthly_token_budget').maybeSingle(),
      ])
      const q = queueData || []
      setStats({ queued: q.filter((i: any) => i.status === 'queued').length, running: q.filter((i: any) => i.status === 'running').length, review: (outputData || []).length, clients: clientCount || 0 })
      setOutputs(outputData || [])
      setQueue(q)
      if (usageData) setUsage({ used: usageData.tokens_used_this_month, budget: usageData.monthly_token_budget })
    }
    load()
  }, [])

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const usagePct = usage ? Math.min(100, Math.round((usage.used / usage.budget) * 100)) : 0
  const usageBar = usagePct >= 90 ? 'var(--red)' : usagePct >= 70 ? 'var(--amber)' : 'var(--green)'

  return (
    <div>
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, color: 'var(--text)', marginBottom: 6, letterSpacing: '0.2px' }}>Dashboard</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Your agents are running. Here is what needs your attention.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 28 }}>
        {[
          { label: 'Clients',      value: stats.clients, hi: false },
          { label: 'Queued',       value: stats.queued,  hi: stats.queued > 0,   c: 'var(--text)' },
          { label: 'Running',      value: stats.running, hi: stats.running > 0,  c: 'var(--amber)' },
          { label: 'Needs review', value: stats.review,  hi: stats.review > 0,   c: 'var(--accent)' },
        ].map(({ label, value, hi, c }) => (
          <div key={label} style={{ ...S.statCard, borderColor: hi ? `${c}28` : 'var(--border)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 36, fontWeight: 500, color: hi ? c : 'var(--text)', lineHeight: 1, letterSpacing: '-1.5px' }}>{value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</div>
          </div>
        ))}
      </div>

      {usage && (
        <div style={{ ...S.panel, marginBottom: 28, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Token usage this month</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12, color: usagePct >= 70 ? usageBar : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {(usage.used / 1000).toFixed(0)}k / {(usage.budget / 1000).toFixed(0)}k
              </span>
              {usagePct >= 80 && <Link href="/settings" style={{ fontSize: 12, color: usageBar, textDecoration: 'none', fontWeight: 500 }}>Adjust limit →</Link>}
            </div>
          </div>
          <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${usagePct}%`, background: usageBar, borderRadius: 99, transition: 'width 0.8s var(--ease)' }} />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={S.panel}>
          <div style={S.panelHead}>Pending review</div>
          {outputs.length === 0 ? <div style={S.empty}>Nothing waiting for review.</div>
            : outputs.map((o: any) => (
              <Link key={o.id} href={`/outputs/${o.id}`} style={{ ...S.row, textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: 'var(--text)', fontSize: 13.5, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.title || o.primary_keyword}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{o.client_profiles?.name} · {fmt(o.created_at)}</div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, flexShrink: 0, marginLeft: 16 }}>Review →</span>
              </Link>
            ))}
        </div>

        <div style={S.panel}>
          <div style={S.panelHead}>Queue activity</div>
          {queue.length === 0 ? <div style={S.empty}>No tasks scheduled yet.</div>
            : queue.map((q: any) => (
              <div key={q.id} style={S.row}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: 'var(--text)', fontSize: 13.5, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.primary_keyword}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{q.client_profiles?.name} · {fmt(q.scheduled_for)}</div>
                </div>
                <StatusBadge status={q.status} />
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
