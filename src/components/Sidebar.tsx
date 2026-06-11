'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AgenceeLogo from '@/components/AgenceeLogo'
import { estimateBlendedCost } from '@/lib/pricing'

// SVG icons keyed by name
const ICONS: Record<string, React.ReactNode> = {
  dashboard: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  marketplace: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-8 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>,
  clients: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  reports: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  chat: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  list: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  calendar: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  tag: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  file: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  upload: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  activity: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  automations: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
  settings: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
}

type Agent = {
  id: string
  name: string
  role: string
  avatar_initials: string
  active: boolean
  nav_items: { label: string; path: string; icon: string }[]
}

type Usage = { tokens_used_this_month: number; monthly_token_budget: number } | null

function NavItem({ href, label, icon, exact }: { href: string; label: string; icon?: React.ReactNode; exact?: boolean }) {
  const path = usePathname()
  const active = exact ? path === href : path === href || path.startsWith(href + '/')
  return (
    <Link href={href} style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '7px 10px',
      borderRadius: '0 var(--radius) var(--radius) 0',
      fontSize: 13, fontWeight: active ? 500 : 400,
      color: active ? '#ffffff' : 'rgba(255,255,255,0.62)',
      background: active ? 'rgba(200,240,208,0.1)' : 'transparent',
      borderLeft: active ? '2px solid var(--brand-accent)' : '2px solid transparent',
      textDecoration: 'none',
      transition: 'background 0.12s, color 0.12s',
      cursor: 'pointer',
    }}
    onMouseEnter={e => {
      if (!active) {
        (e.currentTarget as HTMLElement).style.background = 'rgba(200,240,208,0.07)'
        ;(e.currentTarget as HTMLElement).style.color = '#ffffff'
      }
    }}
    onMouseLeave={e => {
      if (!active) {
        (e.currentTarget as HTMLElement).style.background = 'transparent'
        ;(e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.62)'
      }
    }}
    >
      {icon && <span style={{ opacity: active ? 1 : 0.45, color: active ? 'var(--brand-accent)' : 'currentColor', flexShrink: 0, display: 'flex' }}>{icon}</span>}
      {label}
    </Link>
  )
}

function SubNavItem({ href, label, icon }: { href: string; label: string; icon?: React.ReactNode }) {
  const path = usePathname()
  const active = path === href || path.startsWith(href + '/')
  return (
    <Link href={href} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '5px 10px 5px 26px',
      borderRadius: '0 var(--radius) var(--radius) 0',
      fontSize: 12.5, fontWeight: active ? 500 : 400,
      color: active ? '#ffffff' : 'rgba(255,255,255,0.52)',
      background: active ? 'rgba(200,240,208,0.08)' : 'transparent',
      borderLeft: active ? '2px solid rgba(200,240,208,0.5)' : '2px solid transparent',
      textDecoration: 'none',
      transition: 'background 0.12s, color 0.12s',
      cursor: 'pointer',
    }}
    onMouseEnter={e => {
      if (!active) {
        (e.currentTarget as HTMLElement).style.background = 'rgba(200,240,208,0.07)'
        ;(e.currentTarget as HTMLElement).style.color = '#ffffff'
      }
    }}
    onMouseLeave={e => {
      if (!active) {
        (e.currentTarget as HTMLElement).style.background = 'transparent'
        ;(e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.52)'
      }
    }}
    >
      {icon && <span style={{ opacity: active ? 1 : 0.45, color: 'currentColor', flexShrink: 0, display: 'flex' }}>{icon}</span>}
      {label}
    </Link>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(200,240,208,0.09)', margin: '8px 10px' }} />
}

export default function Sidebar({ onClose }: { onClose?: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [usage, setUsage] = useState<Usage>(null)
  const [workspaceName, setWorkspaceName] = useState<string>('')
  const workspaceIdRef = useRef('')
  const [hasRunning, setHasRunning] = useState(false)
  const [todaySpend, setTodaySpend] = useState<number | null>(null)

  async function refreshTodaySpend(wsId = workspaceIdRef.current) {
    if (!wsId) return
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('agent_activity')
      .select('tokens_used')
      .eq('workspace_id', wsId)
      .gte('created_at', today + 'T00:00:00Z')
    const tokens = (data || []).reduce((a: number, r: any) => a + (r.tokens_used || 0), 0)
    setTodaySpend(estimateBlendedCost(tokens))
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [agentRes, usageRes, wsRes, runRes] = await Promise.all([
        supabase.from('agents').select('id,name,role,avatar_initials,active,nav_items').eq('active', true).order('created_at'),
        supabase.from('workspace_settings').select('tokens_used_this_month,monthly_token_budget').eq('user_id', user.id).maybeSingle(),
        supabase.from('workspaces').select('id,name').eq('owner_id', user.id).maybeSingle(),
        supabase.from('content_queue').select('id', { count: 'exact', head: true }).eq('status', 'running'),
      ])

      setAgents((agentRes.data || []).map((a: any) => ({
        ...a,
        nav_items: Array.isArray(a.nav_items) ? a.nav_items : [],
      })))
      if (usageRes.data) setUsage(usageRes.data)
      if (wsRes.data) {
        workspaceIdRef.current = wsRes.data.id
        setWorkspaceName(wsRes.data.name || '')
      }
      setHasRunning((runRes.count || 0) > 0)

      await refreshTodaySpend(wsRes.data?.id || '')
    }
    load()

    const interval = setInterval(refreshTodaySpend, 30000)
    return () => clearInterval(interval)
  }, [])

  const usagePct = usage ? Math.min(100, Math.round((usage.tokens_used_this_month / usage.monthly_token_budget) * 100)) : 0
  const usageColour = usagePct >= 90 ? 'var(--red)' : usagePct >= 70 ? 'var(--amber)' : 'var(--brand-accent)'

  return (
    <aside style={{
      width: 220,
      height: '100dvh',
      flexShrink: 0,
      background: 'var(--brand)',
      borderRight: '1px solid rgba(200,240,208,0.08)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 18px 14px', borderBottom: '1px solid rgba(200,240,208,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <AgenceeLogo variant="sidebar" animate={false} />
        {workspaceName && (
          <div style={{ fontSize: 10, color: 'rgba(200,240,208,0.4)', marginTop: 5, letterSpacing: '0.3px', paddingLeft: 1 }}>
            {workspaceName}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto' }}>
        <NavItem href="/" label="Dashboard" icon={ICONS.dashboard} exact />
        <NavItem href="/clients" label="Clients" icon={ICONS.clients} />
        <NavItem href="/outputs" label="Outputs" icon={ICONS.file} />
        <NavItem href="/reports" label="Reports" icon={ICONS.reports} />
        <NavItem href="/marketplace" label="Marketplace" icon={ICONS.marketplace} />

        {agents.map(agent => {
          const navItems = agent.nav_items || []
          return (
            <div key={agent.id}>
              <Divider />
              <Link href={`/agents/${agent.id}`} style={{ textDecoration: 'none' }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 10px', cursor: 'pointer', borderRadius: '0 var(--radius) var(--radius) 0' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(200,240,208,0.06)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  <div style={{
                    width: 26, height: 26, borderRadius: 7,
                    background: 'rgba(200,240,208,0.1)',
                    border: '1px solid rgba(200,240,208,0.18)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, color: 'var(--brand-accent)',
                    fontFamily: 'var(--font-mono)', flexShrink: 0,
                    animation: hasRunning && agent.active ? 'pulse-ring 1.8s ease-out infinite' : 'none',
                    boxShadow: hasRunning && agent.active ? '0 0 0 0 rgba(200,240,208,0.55)' : 'none',
                  }}>
                    {agent.avatar_initials || agent.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#ffffff', lineHeight: 1.2 }}>{agent.name}</div>
                    <div style={{ fontSize: 10, color: 'rgba(200,240,208,0.5)', textTransform: 'uppercase', letterSpacing: '0.55px' }}>{agent.role}</div>
                  </div>
                </div>
              </Link>

              {navItems.map((item: { label: string; path: string; icon: string }) => {
                const resolvedPath = item.path.replace('[id]', agent.id)
                return (
                  <SubNavItem
                    key={item.label}
                    href={resolvedPath}
                    label={item.label}
                    icon={ICONS[item.icon]}
                  />
                )
              })}
            </div>
          )
        })}

        <Divider />
      </nav>

      {/* Bottom panel */}
      <div style={{ padding: '12px 12px 18px', borderTop: '1px solid rgba(200,240,208,0.09)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {todaySpend !== null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Today (est.)</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: todaySpend > 1 ? 'var(--amber)' : 'rgba(255,255,255,0.45)' }}>
              ${todaySpend.toFixed(4)}
            </span>
          </div>
        )}
        {usage && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Tokens</span>
              <span style={{ fontSize: 11, color: usagePct >= 70 ? usageColour : 'rgba(255,255,255,0.45)', fontFamily: 'var(--font-mono)' }}>
                {usagePct}%
              </span>
            </div>
            <div style={{ height: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${usagePct}%`, background: usageColour, borderRadius: 99, transition: 'width 0.6s' }} />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 2, borderRadius: 99, background: 'var(--brand-accent)',
            animation: hasRunning ? 'breathe-fast 0.9s ease-in-out infinite' : 'breathe 2.8s ease-in-out infinite' }} />
          <span style={{ fontSize: 10, color: 'rgba(200,240,208,0.45)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
            {hasRunning ? 'running' : 'ready'}
          </span>
        </div>

        <NavItem href="/usage" label="Usage" icon={ICONS.activity} exact />
        <NavItem href="/settings" label="Settings" icon={ICONS.settings} exact />
      </div>
    </aside>
  )
}
