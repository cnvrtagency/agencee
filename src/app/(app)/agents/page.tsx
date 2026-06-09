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
}

const S = {
  h1: { fontSize: 26, fontWeight: 600, color: '#E2E4EE', marginBottom: 4 } as React.CSSProperties,
  sub: { fontSize: 14, color: '#8B91A8', marginBottom: 36 } as React.CSSProperties,
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 } as React.CSSProperties,
  card: {
    background: '#141720', border: '1px solid #252836', borderRadius: 12,
    padding: '24px', cursor: 'pointer', textDecoration: 'none', display: 'block',
    transition: 'border-color 0.15s',
  } as React.CSSProperties,
  avatar: {
    width: 52, height: 52, borderRadius: 12, background: '#1C1F2A',
    border: '1px solid #2A2D3A', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 18, fontWeight: 600, color: '#6366F1',
    marginBottom: 16, fontFamily: '"JetBrains Mono", monospace',
  } as React.CSSProperties,
  name: { fontSize: 17, fontWeight: 600, color: '#E2E4EE', marginBottom: 3 } as React.CSSProperties,
  role: { fontSize: 12, color: '#6366F1', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.8px', marginBottom: 12 },
  desc: { fontSize: 13, color: '#8B91A8', lineHeight: 1.5 } as React.CSSProperties,
  status: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, fontSize: 12, color: '#8B91A8' } as React.CSSProperties,
  dot: { width: 7, height: 7, borderRadius: '50%', background: '#34D399' } as React.CSSProperties,
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])

  useEffect(() => {
    supabase.from('agents').select('*').order('created_at').then(({ data, error }) => {
  console.log('agents data:', data, 'error:', error)
  setAgents(data || [])
})
  }, [])

  return (
    <div>
      <h1 style={S.h1}>Agents</h1>
      <p style={S.sub}>Your AI team. Click an agent to talk to them or update their profile.</p>
      <div style={S.grid}>
        {agents.map(a => (
          <Link key={a.id} href={`/agents/${a.id}`} style={S.card}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#6366F1')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#252836')}>
            <div style={S.avatar}>{a.avatar_initials || a.name.slice(0, 2).toUpperCase()}</div>
            <div style={S.name}>{a.name}</div>
            <div style={S.role}>{a.role}</div>
            <div style={S.desc}>{a.description}</div>
            <div style={S.status}>
              <div style={{ ...S.dot, background: a.active ? '#34D399' : '#8B91A8' }} />
              {a.active ? 'Active' : 'Inactive'}
            </div>
          </Link>
        ))}
        {agents.length === 0 && (
          <div style={{ color: '#8B91A8', fontSize: 14 }}>No agents yet.</div>
        )}
      </div>
    </div>
  )
}
