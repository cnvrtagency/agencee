'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const nav = [
  {
    href: '/', label: 'Dashboard',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  },
  {
    href: '/agents', label: 'Agents',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
  },
  {
    href: '/clients', label: 'Clients',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  },
  {
    href: '/queue', label: 'Queue',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  },
  {
    href: '/outputs', label: 'Outputs',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  },
]

type Usage = { tokens_used_this_month: number; monthly_token_budget: number; workspace_name: string } | null

export default function Sidebar() {
  const path = usePathname()
  const [usage, setUsage] = useState<Usage>(null)

  useEffect(() => {
    supabase.from('workspace_settings').select('tokens_used_this_month,monthly_token_budget,workspace_name').maybeSingle().then(({ data }) => {
      if (data) setUsage(data)
    })
  }, [])

  const usagePct = usage ? Math.min(100, Math.round((usage.tokens_used_this_month / usage.monthly_token_budget) * 100)) : 0
  const usageColour = usagePct >= 90 ? 'var(--red)' : usagePct >= 70 ? 'var(--amber)' : 'var(--accent)'

  return (
    <aside style={{
      width: 240,
      flexShrink: 0,
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      position: 'fixed',
      top: 0, left: 0, bottom: 0,
    }}>
      {/* Wordmark */}
      <div style={{ padding: '28px 24px 24px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text)', letterSpacing: '0.3px', lineHeight: 1 }}>
          Agencee
        </div>
        {usage?.workspace_name && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5, letterSpacing: '0.3px' }}>
            {usage.workspace_name}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        {nav.map(({ href, label, icon }) => {
          const active = href === '/' ? path === '/' : path.startsWith(href)
          return (
            <Link key={href} href={href} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px', borderRadius: 'var(--radius)',
              fontSize: 13.5, fontWeight: active ? 500 : 400,
              color: active ? 'var(--text)' : 'var(--text-muted)',
              background: active ? 'var(--surface-2)' : 'transparent',
              textDecoration: 'none',
              transition: 'var(--transition)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)' } }}
            onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' } }}
            >
              <span style={{ opacity: active ? 1 : 0.6, color: active ? 'var(--accent)' : 'currentColor', flexShrink: 0 }}>{icon}</span>
              {label}
              {active && <span style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />}
            </Link>
          )
        })}
      </nav>

      {/* Bottom */}
      <div style={{ padding: '16px 16px 24px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Usage bar */}
        {usage && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Token usage</span>
              <span style={{ fontSize: 11, color: usagePct >= 70 ? usageColour : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {usagePct}%
              </span>
            </div>
            <div style={{ height: 3, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${usagePct}%`, background: usageColour, borderRadius: 99, transition: 'width 0.6s var(--ease)' }} />
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 5, fontFamily: 'var(--font-mono)' }}>
              {(usage.tokens_used_this_month / 1000).toFixed(0)}k / {(usage.monthly_token_budget / 1000).toFixed(0)}k this month
            </div>
          </div>
        )}

        {/* Settings link */}
        <Link href="/settings" style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', borderRadius: 'var(--radius)',
          fontSize: 13, color: path === '/settings' ? 'var(--text)' : 'var(--text-muted)',
          background: path === '/settings' ? 'var(--surface-2)' : 'transparent',
          textDecoration: 'none', transition: 'var(--transition)',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text)' }}
        onMouseLeave={e => { if (path !== '/settings') (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Settings
        </Link>
      </div>
    </aside>
  )
}
