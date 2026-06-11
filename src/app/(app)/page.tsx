'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import StatusBadge from '@/components/StatusBadge'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Sonnet 4.6 pricing: $3/M input, $15/M output — blended ~$4/M average
const COST_PER_TOKEN = 4 / 1_000_000

function toTitleCase(str: string) {
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

const S: Record<string, React.CSSProperties> = {
  statCard: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)', padding: '20px 22px',
    display: 'flex', flexDirection: 'column',
    cursor: 'pointer', textDecoration: 'none', color: 'inherit',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    position: 'relative', overflow: 'hidden',
  },
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
  panelHead: { padding: '10px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: '0.09em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid var(--border)' },
  empty: { padding: '40px 20px', fontSize: 13, color: 'var(--text-2)', textAlign: 'center' as const },
}

function buildCalendar(days = 35) {
  const out: { date: string; day: number }[] = []
  const today = new Date(); today.setHours(0,0,0,0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i)
    out.push({ date: d.toISOString().split('T')[0], day: d.getDay() })
  }
  return out
}

function tokensToCost(t: number) {
  const c = t * COST_PER_TOKEN
  return c < 0.01 ? '<$0.01' : `$${c.toFixed(2)}`
}

type BriefingItem = {
  id: string; type: string; title: string; body: string; action_url: string | null; priority: number; dismissed: boolean
}

const BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  opportunity: { bg: 'var(--accent-bg)', color: 'var(--accent)' },
  decay: { bg: 'rgba(245,158,11,0.15)', color: 'var(--amber)' },
  gap: { bg: 'rgba(139,92,246,0.15)', color: 'var(--purple, #8b5cf6)' },
  suggestion: { bg: 'rgba(34,197,94,0.15)', color: 'var(--green)' },
  schedule: { bg: 'var(--surface-3)', color: 'var(--text-2)' },
}

function PendingOutputRow({ output: o, fmt, onRemove, onApprove }: { output: any; fmt: (d: string) => string; onRemove: (id: string) => void; onApprove: () => void }) {
  const [approving, setApproving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [fading, setFading] = useState(false)

  async function approve() {
    setApproving(true)
    await supabase.from('content_outputs').update({ approved: true }).eq('id', o.id)
    await supabase.from('content_history').insert({
      client_id: o.client_id,
      title: o.title || o.primary_keyword,
      primary_keyword: o.primary_keyword,
      summary: o.meta_description || `Approved output: ${o.title}`,
      published_at: new Date().toISOString(),
    })
    if (o.primary_keyword && o.client_id) {
      await supabase
        .from('keyword_banks')
        .update({ content_targeting_this: `/outputs/${o.id}` })
        .eq('client_id', o.client_id)
        .ilike('keyword', o.primary_keyword)
    }
    setFading(true)
    setTimeout(() => { onRemove(o.id); onApprove() }, 350)
  }

  async function doDelete() {
    setDeleting(true)
    await supabase.from('content_outputs').delete().eq('id', o.id)
    setFading(true)
    setTimeout(() => onRemove(o.id), 350)
  }

  return (
    <div style={{ ...S.row, transition: 'opacity 0.35s, transform 0.35s', opacity: fading ? 0 : 1, transform: fading ? 'translateX(-8px)' : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: 'var(--text)', fontSize: 13, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.title || o.primary_keyword}</div>
        <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{o.client_profiles?.name} · {fmt(o.created_at)}</div>
      </div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
        <button
          onClick={approve} disabled={approving}
          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--brand)', color: 'var(--brand-accent)', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
          {approving ? '…' : 'Approve'}
        </button>
        <Link href={`/outputs/${o.id}`} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius)', background: 'var(--surface-2)', color: 'var(--text-2)', fontWeight: 500, textDecoration: 'none', whiteSpace: 'nowrap' as const }}>Review</Link>
        {confirmDelete ? (
          <>
            <button onClick={doDelete} disabled={deleting} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 99, border: 'none', background: 'rgba(242,107,107,0.15)', color: 'var(--red)', fontWeight: 600, cursor: 'pointer' }}>{deleting ? '…' : 'Confirm'}</button>
            <button onClick={() => setConfirmDelete(false)} style={{ fontSize: 11, padding: '3px 6px', borderRadius: 99, border: 'none', background: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>✕</button>
          </>
        ) : (
          <button onClick={() => setConfirmDelete(true)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, border: 'none', background: 'none', color: 'var(--text-dim)', cursor: 'pointer', whiteSpace: 'nowrap' as const }}>Delete ✗</button>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const router = useRouter()
  const [stats, setStats] = useState({ queued: 0, running: 0, review: 0, clients: 0 })
  const [outputs, setOutputs] = useState<any[]>([])
  const [queue, setQueue] = useState<any[]>([])
  const [usage, setUsage] = useState<{ used: number; budget: number } | null>(null)
  const [agentUsage, setAgentUsage] = useState<{ name: string; tokens: number; color: string }[]>([])
  const [calData, setCalData] = useState<Record<string, number>>({})
  const [calHover, setCalHover] = useState<string | null>(null)
  const [briefingItems, setBriefingItems] = useState<BriefingItem[]>([])
  const [briefingTotal, setBriefingTotal] = useState(0)
  const [briefingExpanded, setBriefingExpanded] = useState(false)

  const AGENT_COLORS = ['var(--accent)','var(--green)','var(--amber)','var(--purple)','#06B6D4']

  async function loadBriefing() {
    const res = await fetch('/api/briefing-items?dismissed=false&limit=50')
    const { data, count } = await res.json()
    setBriefingItems(data || [])
    setBriefingTotal(count || 0)
  }

  async function dismissBriefing(itemId: string) {
    await fetch('/api/briefing-items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: itemId, dismissed: true }) })
    setBriefingItems(prev => prev.filter(i => i.id !== itemId))
    setBriefingTotal(t => Math.max(0, t - 1))
  }

  async function dismissAll() {
    const ids = briefingItems.map(i => i.id)
    await fetch('/api/briefing-items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, dismissed: true }) })
    setBriefingItems([])
    setBriefingTotal(0)
  }

  useEffect(() => {
    loadBriefing()
  }, [])

  useEffect(() => {
    async function load() {
      const [{ data: queueData }, { data: outputData }, { count: clientCount }, { data: usageData }, { data: msgData }] = await Promise.all([
        supabase.from('content_queue').select('*, client_profiles(name)').order('created_at', { ascending: false }).limit(8),
        supabase.from('content_outputs').select('*, client_profiles(name)').eq('approved', false).order('created_at', { ascending: false }).limit(6),
        supabase.from('client_profiles').select('*', { count: 'exact', head: true }),
        supabase.from('workspace_settings').select('tokens_used_this_month,monthly_token_budget').maybeSingle(),
        supabase.from('conversations').select('id, agent_id, agents(name), created_at').order('created_at', { ascending: false }).limit(500),
      ])
      const q = queueData || []
      setStats({ queued: q.filter((i: any) => i.status === 'queued').length, running: q.filter((i: any) => i.status === 'running').length, review: (outputData || []).length, clients: clientCount || 0 })
      setOutputs(outputData || [])
      setQueue(q)
      if (usageData) setUsage({ used: usageData.tokens_used_this_month, budget: usageData.monthly_token_budget })

      const cal: Record<string, number> = {}
      ;(msgData || []).forEach((c: any) => {
        const day = c.created_at?.split('T')[0]
        if (day) cal[day] = (cal[day] || 0) + 1
      })
      setCalData(cal)

      const agentCount: Record<string, { name: string; count: number }> = {}
      ;(msgData || []).forEach((c: any) => {
        const aid = c.agent_id; const name = (c.agents as any)?.name || 'Unknown'
        if (!agentCount[aid]) agentCount[aid] = { name, count: 0 }
        agentCount[aid].count++
      })
      const total = Object.values(agentCount).reduce((a, b) => a + b.count, 0) || 1
      const totalTokens = usageData?.tokens_used_this_month || 0
      setAgentUsage(Object.entries(agentCount).map(([, v], i) => ({
        name: v.name, tokens: Math.round((v.count / total) * totalTokens), color: AGENT_COLORS[i % AGENT_COLORS.length]
      })).sort((a, b) => b.tokens - a.tokens))
    }
    load()
  }, [])

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const usagePct = usage ? Math.min(100, Math.round((usage.used / usage.budget) * 100)) : 0
  const usageBar = usagePct >= 90 ? 'var(--red)' : usagePct >= 70 ? 'var(--amber)' : 'var(--green)'
  const calendar = buildCalendar(35)
  const maxCal = Math.max(1, ...Object.values(calData))

  const statItems = [
    { label: 'Clients',      value: stats.clients, href: '/clients',              hi: false,               c: 'var(--text)' },
    { label: 'Queued',       value: stats.queued,  href: '/queue?filter=queued',  hi: stats.queued > 0,    c: 'var(--text)' },
    { label: 'Running',      value: stats.running, href: '/queue?filter=running', hi: stats.running > 0,   c: 'var(--amber)' },
    { label: 'Needs review', value: stats.review,  href: '/outputs',              hi: stats.review > 0,    c: 'var(--accent)' },
  ]

  return (
    <div>
      <div style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Overview</div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.6px', fontFamily: 'var(--font-sans)' }}>Dashboard</h1>
      </div>

      {/* Briefing Room */}
      <div style={{ marginBottom: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div style={{ padding: '10px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Briefing Room</span>
            {briefingTotal > 0 && (
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', background: 'var(--surface-3)', padding: '1px 7px', borderRadius: 99 }}>{briefingTotal} opportunities</span>
            )}
          </div>
          {briefingTotal > 0 && (
            <button onClick={dismissAll} style={{ fontSize: 11, color: 'var(--text-2)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>Dismiss all</button>
          )}
        </div>
        {briefingItems.length === 0 ? (
          <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>Everything looks good. No actions needed right now.</div>
        ) : (
          <>
            {(() => {
              const visible = briefingExpanded ? briefingItems : briefingItems.slice(0, 3)
              const hidden = briefingItems.length - 3
              return (
                <>
                  {visible.map((item, i) => {
                    const colors = BADGE_COLORS[item.type] || BADGE_COLORS.suggestion
                    // Extract position + impressions from body for data line
                    const posMatch = item.body.match(/Ranking #(\d+)/)
                    const impMatch = item.body.match(/(\d[\d,]*) impressions/)
                    const clickMatch = item.body.match(/~(\d+) additional clicks/)
                    const dataLine = posMatch ? `Position #${posMatch[1]}${impMatch ? ` · ${impMatch[1]} impressions/month` : ''}${clickMatch ? ` · est. ${clickMatch[1]} additional clicks if page 1` : ''}` : item.body
                    // Extract the keyword from title (e.g. Near-miss: "keyword")
                    const kwMatch = item.title.match(/"([^"]+)"/)
                    const displayTitle = kwMatch ? `"${kwMatch[1]}"` : item.title
                    return (
                      <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i < visible.length - 1 || (!briefingExpanded && hidden > 0) ? '1px solid var(--border)' : 'none' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: colors.color, background: colors.bg, padding: '2px 7px', borderRadius: 'var(--radius)', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>{item.type}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{displayTitle}</span>
                          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 1 }}>{dataLine}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                          {item.action_url && (
                            <Link href={item.action_url} style={{ fontSize: 12, color: colors.color, textDecoration: 'none', background: colors.bg, padding: '3px 9px', borderRadius: 'var(--radius)', fontWeight: 500, whiteSpace: 'nowrap' as const }}>Act →</Link>
                          )}
                          <button onClick={() => dismissBriefing(item.id)} style={{ fontSize: 11, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px' }}>Dismiss</button>
                        </div>
                      </div>
                    )
                  })}
                  {!briefingExpanded && hidden > 0 && (
                    <button onClick={() => setBriefingExpanded(true)} style={{ width: '100%', padding: '9px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--accent)', textAlign: 'left' as const }}>
                      Show {hidden} more →
                    </button>
                  )}
                  {briefingExpanded && briefingItems.length > 3 && (
                    <button onClick={() => setBriefingExpanded(false)} style={{ width: '100%', padding: '9px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-2)', textAlign: 'left' as const }}>
                      Show less
                    </button>
                  )}
                </>
              )
            })()}
          </>
        )}
      </div>

      {/* Morning digest */}
      {(stats.review > 0 || stats.running > 0 || stats.queued > 0) && (
        <div style={{ marginBottom: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid var(--brand)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 12 }}>What needs your attention</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {stats.review > 0 && (
              <Link href="/outputs" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.75'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 500 }}>
                  {stats.review} draft{stats.review !== 1 ? 's' : ''} waiting for review
                </span>
                <span style={{ fontSize: 12, color: 'var(--accent)', marginLeft: 'auto' }}>Review →</span>
              </Link>
            )}
            {stats.running > 0 && (
              <Link href="/queue?filter=running" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.75'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)', flexShrink: 0, animation: 'breathe-fast 1s ease-in-out infinite' }} />
                <span style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 500 }}>
                  {stats.running} task{stats.running !== 1 ? 's' : ''} running now
                </span>
                <span style={{ fontSize: 12, color: 'var(--amber)', marginLeft: 'auto' }}>Watch →</span>
              </Link>
            )}
            {stats.queued > 0 && (
              <Link href="/queue?filter=queued" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.75'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-dim)', flexShrink: 0 }} />
                <span style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 500 }}>
                  {stats.queued} task{stats.queued !== 1 ? 's' : ''} queued
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-2)', marginLeft: 'auto' }}>View →</span>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 28 }} className="stat-grid">
        {statItems.map(({ label, value, href, hi, c }) => (
          <Link key={label} href={href} style={{
            ...S.statCard,
            borderColor: hi ? `${c}30` : 'var(--border)',
            borderLeft: hi ? `3px solid ${c}` : undefined,
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement
            el.style.borderColor = 'var(--border-bright)'
            el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement
            el.style.borderColor = hi ? `${c}30` : 'var(--border)'
            el.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'
          }}
          >
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 40, fontWeight: 600, color: hi ? c : 'var(--text)', lineHeight: 1, letterSpacing: '-2px' }}>{value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 8 }}>{label}</div>
          </Link>
        ))}
      </div>

      {/* Token usage */}
      {usage && (
        <div style={{ ...S.panel, marginBottom: 20 }}>
          <div style={S.panelHead}>
            <span>Token usage this month</span>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)', fontWeight: 400 }}>
                {(usage.used / 1000).toFixed(0)}k / {(usage.budget / 1000).toFixed(0)}k tokens
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>
                est. {tokensToCost(usage.used)}
              </span>
              {usagePct >= 80 && <Link href="/settings" style={{ fontSize: 12, color: usageBar, textDecoration: 'none', fontWeight: 500 }}>Adjust limit →</Link>}
            </div>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <div style={{ height: 3, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden', marginBottom: 20 }}>
              <div style={{ height: '100%', width: `${usagePct}%`, background: usageBar, borderRadius: 99, transition: 'width 0.8s var(--ease)' }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'start' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>By agent</div>
                {agentUsage.length === 0
                  ? <div style={{ fontSize: 13, color: 'var(--text-2)' }}>No agent activity yet.</div>
                  : agentUsage.map(a => (
                  <div key={a.name} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: a.color, display: 'inline-block', flexShrink: 0 }} />
                        {a.name}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>
                        {(a.tokens / 1000).toFixed(0)}k · <span style={{ color: 'var(--green)' }}>{tokensToCost(a.tokens)}</span>
                      </span>
                    </div>
                    <div style={{ height: 3, background: 'var(--surface-3)', borderRadius: 99 }}>
                      <div style={{ height: '100%', width: `${Math.round((a.tokens / (usage.used || 1)) * 100)}%`, background: a.color, borderRadius: 99, opacity: 0.7 }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* 5-week activity calendar */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>Activity (5 weeks)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 14px)', gap: 3 }}>
                  {['M','T','W','T','F','S','S'].map((d,i) => (
                    <div key={i} style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'center', marginBottom: 2 }}>{d}</div>
                  ))}
                  {calendar.map(({ date }) => {
                    const count = calData[date] || 0
                    const intensity = count === 0 ? 0 : Math.max(0.15, count / maxCal)
                    const isToday = date === new Date().toISOString().split('T')[0]
                    return (
                      <div key={date}
                        onMouseEnter={() => setCalHover(date)}
                        onMouseLeave={() => setCalHover(null)}
                        title={`${date}: ${count} conversation${count !== 1 ? 's' : ''}`}
                        style={{ width: 14, height: 14, borderRadius: 3,
                          background: count === 0 ? 'var(--surface-3)' : `rgba(6,50,39,${intensity})`,
                          border: isToday ? '1px solid rgba(6,50,39,0.5)' : '1px solid transparent',
                          transition: 'opacity 0.1s', opacity: calHover && calHover !== date ? 0.5 : 1,
                        }} />
                    )
                  })}
                </div>
                {calHover && calData[calHover] && (
                  <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 6, textAlign: 'right' }}>
                    {new Date(calHover).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {calData[calHover]} conversation{calData[calHover] !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Pending review — inline approve/reject */}
        <div style={S.panel}>
          <div style={S.panelHead}><span>Pending review ({outputs.length})</span></div>
          {outputs.length === 0
            ? <div style={S.empty}>Nothing waiting for review.</div>
            : outputs.map((o: any) => (
              <PendingOutputRow key={o.id} output={o} fmt={fmt} onRemove={(id) => setOutputs(prev => prev.filter(x => x.id !== id))} onApprove={() => setStats(s => ({ ...s, review: Math.max(0, s.review - 1) }))} />
            ))}
        </div>

        {/* Queue activity */}
        <div style={S.panel}>
          <div style={S.panelHead}><span>Queue activity</span></div>
          {queue.length === 0
            ? <div style={S.empty}>No tasks scheduled yet.</div>
            : queue.map((q: any) => (
              <div key={q.id} style={S.row}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: 'var(--text)', fontSize: 13.5, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toTitleCase(q.primary_keyword)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{q.client_profiles?.name} · {fmt(q.scheduled_for)}</div>
                </div>
                <StatusBadge status={q.status} />
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
