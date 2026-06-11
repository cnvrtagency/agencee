'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

type Agent = {
  id: string
  name: string
  role: string
  avatar_initials: string
  description: string
  active: boolean
  agent_type: string
  created_at: string
  last_conversation_at?: string
  nav_items?: { label: string; path: string; icon: string }[]
}

function timeAgo(dateStr: string | undefined) {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs  = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      const [{ data: agentData }, { data: convData }, { data: queueData }] = await Promise.all([
        supabase.from('agents').select('*,nav_items').order('created_at'),
        supabase.from('conversations').select('agent_id, created_at').order('created_at', { ascending: false }),
        supabase.from('content_queue').select('agent_id').eq('status', 'running'),
      ])
      // Most recent conversation per agent
      const latestConv: Record<string, string> = {}
      ;(convData || []).forEach((c: any) => {
        if (!latestConv[c.agent_id]) latestConv[c.agent_id] = c.created_at
      })
      setAgents((agentData || []).map((a: any) => ({ ...a, last_conversation_at: latestConv[a.id] })))
      setRunningIds(new Set((queueData || []).map((q: any) => q.agent_id)))
    }
    load()
  }, [])

  return (
    <div>
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.5px' }}>Agents</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Your AI team. Click an agent to start a conversation or update their profile.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 14 }}>
        {agents.map(a => {
          const isRunning = runningIds.has(a.id)
          return (
            <div key={a.id}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
                transition: 'border-color 0.15s, box-shadow 0.15s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-bright)'
                ;(e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.4)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                ;(e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'
              }}
            >
            <Link href={`/agents/${a.id}`}
              style={{
                padding: 24, cursor: 'pointer', textDecoration: 'none', display: 'block',
                color: 'inherit',
              }}
            >
              {/* Avatar with pulse ring if running */}
              <div style={{
                width: 52, height: 52, borderRadius: 12,
                background: 'var(--surface-3)', border: '1px solid var(--border-bright)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 600, color: 'var(--accent)',
                marginBottom: 18, fontFamily: 'var(--font-mono)',
                animation: isRunning ? 'pulse-ring 1.8s ease-out infinite' : 'none',
                boxShadow: isRunning ? '0 0 0 0 rgba(79,127,255,0.55)' : 'none',
              }}>
                {a.avatar_initials || a.name.slice(0, 2).toUpperCase()}
              </div>

              <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{a.name}</div>
              <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>{a.role}</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 18 }}>{a.description}</div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: a.active ? 'var(--green)' : 'var(--border-bright)',
                    flexShrink: 0,
                  }} />
                  {a.active ? (isRunning ? 'Running now' : 'Active') : 'Inactive'}
                </div>
                {a.last_conversation_at && (
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{timeAgo(a.last_conversation_at)}</span>
                )}
              </div>

            </Link>

              {/* Quick-nav pills */}
              {(a.nav_items || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '12px 24px 18px', borderTop: '1px solid var(--border)' }}>
                  {(a.nav_items || []).map((item: any) => (
                    <Link key={item.label}
                      href={item.path.replace('[id]', a.id)}
                      style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-2)', textDecoration: 'none', fontWeight: 500, letterSpacing: '0.2px' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Add agent card */}
        <div style={{
          background: 'transparent', border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)',
          padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: 200, gap: 10, opacity: 0.5, cursor: 'default',
        }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, border: '1.5px dashed var(--border-bright)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-2)', letterSpacing: '0.3px' }}>Add agent</span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>Coming soon</span>
        </div>

        {agents.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-2)', gridColumn: '1/-1', padding: '20px 0' }}>No agents configured yet.</div>
        )}
      </div>
    </div>
  )
}
