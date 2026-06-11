'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { estimateBlendedCost } from '@/lib/pricing'

type ActivityRow = {
  id: string
  tokens_used: number | null
  action: string | null
  created_at: string
  agent_id: string | null
  client_id: string | null
  agents?: { name?: string | null } | null
  client_profiles?: { name?: string | null } | null
}

const S: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' },
  panelHead: { padding: '12px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.09em' },
  muted: { fontSize: 12, color: 'var(--text-2)' },
  th: { fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, padding: '10px 14px', borderBottom: '1px solid var(--border)' },
  td: { fontSize: 13, color: 'var(--text)', padding: '10px 14px', borderBottom: '1px solid var(--border)' },
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfWeek() {
  const d = startOfToday()
  const diff = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - diff)
  return d
}

function startOfMonth() {
  const d = startOfToday()
  d.setDate(1)
  return d
}

function dayKey(d: Date) {
  return d.toISOString().split('T')[0]
}

function fmtTokens(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1000)}k`
  return tokens.toLocaleString()
}

function fmtCost(tokens: number) {
  const cost = estimateBlendedCost(tokens)
  return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`
}

function groupRows(rows: ActivityRow[], getKey: (row: ActivityRow) => string) {
  const map = new Map<string, number>()
  for (const row of rows) {
    const key = getKey(row)
    map.set(key, (map.get(key) || 0) + (row.tokens_used || 0))
  }
  return [...map.entries()]
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
}

function UsageTable({ rows }: { rows: { name: string; tokens: number }[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...S.th, textAlign: 'left' }}>Name</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Tokens</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Cost (est.)</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={3} style={{ ...S.td, textAlign: 'center', color: 'var(--text-2)' }}>No tracked usage</td></tr>
          ) : rows.map(row => (
            <tr key={row.name}>
              <td style={S.td}>{row.name}</td>
              <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtTokens(row.tokens)}</td>
              <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{fmtCost(row.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function UsagePage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [budget, setBudget] = useState(500000)
  const [tokensUsedThisMonth, setTokensUsedThisMonth] = useState(0)
  const [savingBudget, setSavingBudget] = useState(false)
  const [savedBudget, setSavedBudget] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Sign in to view usage.')
      setLoading(false)
      return
    }

    const { data: workspace } = await supabase.from('workspaces').select('id').eq('owner_id', user.id).maybeSingle()
    if (!workspace?.id) {
      setError('No workspace found.')
      setLoading(false)
      return
    }

    setWorkspaceId(workspace.id)
    const monthAgo = new Date()
    monthAgo.setDate(monthAgo.getDate() - 30)

    const [{ data: settings }, { data: activity, error: activityError }] = await Promise.all([
      supabase.from('workspace_settings').select('monthly_token_budget,tokens_used_this_month').eq('user_id', user.id).maybeSingle(),
      supabase
        .from('agent_activity')
        .select('id,tokens_used,action,created_at,agent_id,client_id,agents(name),client_profiles(name)')
        .eq('workspace_id', workspace.id)
        .gte('created_at', monthAgo.toISOString())
        .order('created_at', { ascending: true })
        .limit(5000),
    ])

    if (activityError) {
      setError(activityError.message)
      setLoading(false)
      return
    }

    setBudget(settings?.monthly_token_budget || 500000)
    setTokensUsedThisMonth(settings?.tokens_used_this_month || 0)
    setRows((activity || []) as ActivityRow[])
    setLoading(false)
  }

  async function saveBudget() {
    if (!workspaceId) return
    setSavingBudget(true)
    setSavedBudget(false)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('workspace_settings').upsert({
        user_id: user.id,
        workspace_id: workspaceId,
        monthly_token_budget: budget,
        updated_at: new Date().toISOString(),
      })
      setSavedBudget(true)
      setTimeout(() => setSavedBudget(false), 2000)
    }
    setSavingBudget(false)
  }

  const stats = useMemo(() => {
    const today = startOfToday().getTime()
    const week = startOfWeek().getTime()
    const month = startOfMonth().getTime()
    const sum = (after: number) => rows
      .filter(row => new Date(row.created_at).getTime() >= after)
      .reduce((acc, row) => acc + (row.tokens_used || 0), 0)
    return {
      today: sum(today),
      week: sum(week),
      month: sum(month),
    }
  }, [rows])

  const grouped = useMemo(() => ({
    agents: groupRows(rows, row => row.agents?.name || 'System / background'),
    clients: groupRows(rows, row => row.client_profiles?.name || 'System / background'),
    actions: groupRows(rows, row => row.action?.replace(/_/g, ' ') || 'unknown'),
  }), [rows])

  const daily = useMemo(() => {
    const days: { date: string; tokens: number }[] = []
    const today = startOfToday()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      days.push({ date: dayKey(d), tokens: 0 })
    }
    const index = new Map(days.map((d, i) => [d.date, i]))
    for (const row of rows) {
      const key = row.created_at.split('T')[0]
      const i = index.get(key)
      if (i !== undefined) days[i].tokens += row.tokens_used || 0
    }
    return days
  }, [rows])

  const maxDaily = Math.max(1, ...daily.map(d => d.tokens))
  const budgetPct = budget > 0 ? Math.min(100, Math.round((tokensUsedThisMonth / budget) * 100)) : 0
  const budgetColour = budgetPct >= 90 ? 'var(--red)' : budgetPct >= 80 ? 'var(--amber)' : 'var(--green)'

  if (loading) return <div style={{ color: 'var(--text-2)', fontSize: 14, padding: 40 }}>Loading usage...</div>

  return (
    <div style={{ maxWidth: 1040 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, marginBottom: 32 }}>
        <div>
          <div style={{ ...S.label, marginBottom: 6 }}>Usage</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.5px' }}>Token spend</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6 }}>All figures are estimates from tracked model usage.</p>
        </div>
        <Link href="/settings" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)' }}>
          Settings
        </Link>
      </div>

      {error && (
        <div style={{ background: 'var(--red-bg)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius)', padding: '12px 14px', color: 'var(--red)', fontSize: 13, marginBottom: 20 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 18 }}>
        {[
          { label: 'Today', tokens: stats.today },
          { label: 'This week', tokens: stats.week },
          { label: 'This month', tokens: stats.month },
        ].map(item => (
          <div key={item.label} style={{ ...S.panel, padding: '18px 20px' }}>
            <div style={S.label}>{item.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10 }}>
              <span style={{ fontSize: 28, color: 'var(--text)', fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '-1px' }}>{fmtTokens(item.tokens)}</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{fmtCost(item.tokens)}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ ...S.panel, marginBottom: 18 }}>
        <div style={S.panelHead}>
          <span style={S.label}>Budget</span>
          <span style={{ ...S.muted, fontFamily: 'var(--font-mono)' }}>{fmtTokens(tokensUsedThisMonth)} / {fmtTokens(budget)} ({budgetPct}%)</span>
        </div>
        <div style={{ padding: 18 }}>
          <div style={{ height: 8, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ width: `${budgetPct}%`, height: '100%', background: budgetColour, borderRadius: 99, transition: 'width 0.5s var(--ease)' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={budget} onChange={e => setBudget(parseInt(e.target.value) || 500000)} style={{ maxWidth: 260 }}>
              <option value="200000">200,000 tokens</option>
              <option value="500000">500,000 tokens</option>
              <option value="1000000">1,000,000 tokens</option>
              <option value="2000000">2,000,000 tokens</option>
              <option value="5000000">5,000,000 tokens</option>
            </select>
            <button onClick={saveBudget} disabled={savingBudget} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: savingBudget ? 'not-allowed' : 'pointer', opacity: savingBudget ? 0.7 : 1 }}>
              {savingBudget ? 'Saving...' : 'Save budget'}
            </button>
            {savedBudget && <span style={{ fontSize: 13, color: 'var(--green)' }}>Saved</span>}
          </div>
        </div>
      </div>

      <div style={{ ...S.panel, marginBottom: 18 }}>
        <div style={S.panelHead}>
          <span style={S.label}>Daily usage, last 30 days</span>
          <span style={S.muted}>Cost shown with blended $4/M estimate</span>
        </div>
        <div style={{ padding: '18px 18px 16px', height: 180, display: 'flex', alignItems: 'end', gap: 5 }}>
          {daily.map(day => {
            const h = Math.max(3, Math.round((day.tokens / maxDaily) * 132))
            return (
              <div key={day.date} title={`${day.date}: ${fmtTokens(day.tokens)} tokens, ${fmtCost(day.tokens)}`} style={{ flex: 1, minWidth: 4, height: h, background: day.tokens ? 'var(--accent)' : 'var(--surface-3)', borderRadius: '4px 4px 2px 2px', opacity: day.tokens ? 0.9 : 0.55 }} />
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
        <div style={S.panel}>
          <div style={S.panelHead}><span style={S.label}>By agent</span></div>
          <UsageTable rows={grouped.agents} />
        </div>
        <div style={S.panel}>
          <div style={S.panelHead}><span style={S.label}>By client</span></div>
          <UsageTable rows={grouped.clients} />
        </div>
        <div style={S.panel}>
          <div style={S.panelHead}><span style={S.label}>By action</span></div>
          <UsageTable rows={grouped.actions} />
        </div>
      </div>
    </div>
  )
}
