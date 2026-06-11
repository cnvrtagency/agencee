'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const COST_BLENDED = 4 / 1_000_000

export default function AgentOverviewPage() {
  const { id: agentId } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<any>(null)
  const [stats, setStats] = useState<{
    totalTokens: number
    totalCost: number
    totalConversations: number
    totalContent: number
    totalKeywords: number
    thisWeekTokens: number
    thisMonthTokens: number
  } | null>(null)
  const [recentActivity, setRecentActivity] = useState<any[]>([])
  const [knowledge, setKnowledge] = useState<any[]>([])
  const [clients, setClients] = useState<any[]>([])
  const [digest, setDigest] = useState<any>(null)
  const [automations, setAutomations] = useState<any[]>([])

  useEffect(() => {
    if (!agentId) return
    load()
  }, [agentId])

  async function load() {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString()

    const [
      { data: agentData },
      { data: activityData },
      { data: weekActivity },
      { data: monthActivity },
      convData,
      outputData,
      kwData,
      { data: clientData },
      { data: digestData },
      { data: automationData },
    ] = await Promise.all([
      supabase.from('agents').select('*').eq('id', agentId).single(),
      supabase.from('agent_activity').select('id,tokens_used,action,detail,created_at').eq('agent_id', agentId).order('created_at', { ascending: false }).limit(20),
      supabase.from('agent_activity').select('tokens_used').eq('agent_id', agentId).gte('created_at', weekAgo),
      supabase.from('agent_activity').select('tokens_used').eq('agent_id', agentId).gte('created_at', monthAgo),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('agent_id', agentId),
      supabase.from('content_outputs').select('id', { count: 'exact', head: true }).eq('agent_type', 'seo'),
      supabase.from('keyword_suggestions').select('id', { count: 'exact', head: true }).eq('suggested_by', agentId),
      supabase.from('client_profiles').select('id,name,website').order('name'),
      supabase.from('agent_knowledge').select('summary,week_of,created_at').eq('agent_type', 'seo').order('week_of', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('agent_automations').select('*').eq('agent_id', agentId).order('created_at'),
    ])

    setAgent(agentData)
    setRecentActivity(activityData || [])
    setClients(clientData || [])
    setDigest(digestData)
    setAutomations(automationData || [])

    const totalTokens = (activityData || []).reduce((a: number, r: any) => a + (r.tokens_used || 0), 0)
    const weekTokens = (weekActivity || []).reduce((a: number, r: any) => a + (r.tokens_used || 0), 0)
    const monthTokens = (monthActivity || []).reduce((a: number, r: any) => a + (r.tokens_used || 0), 0)

    setStats({
      totalTokens,
      totalCost: totalTokens * COST_BLENDED,
      totalConversations: (convData as any)?.count || 0,
      totalContent: (outputData as any)?.count || 0,
      totalKeywords: (kwData as any)?.count || 0,
      thisWeekTokens: weekTokens,
      thisMonthTokens: monthTokens,
    })

    if (clientData?.length) {
      const { data: knowledgeData } = await supabase
        .from('client_knowledge')
        .select('client_id,site_pages,gsc_snapshot,content_summary,agent_notes,docs,site_pages_updated_at,gsc_snapshot_updated_at')
        .in('client_id', clientData.map((c: any) => c.id))
      setKnowledge(knowledgeData || [])
    }
  }

  if (!agent) return <div style={{ color: 'var(--text-2)', fontSize: 14, padding: 40 }}>Loading...</div>

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const fmtRel = (d: string) => {
    const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.round(hrs / 24)}d ago`
  }

  const S = {
    panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 16 } as React.CSSProperties,
    panelHead: { padding: '12px 18px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1.2px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    stat: { textAlign: 'center' as const, padding: '16px 12px' },
    statNum: { fontSize: 28, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)', letterSpacing: '-1px' },
    statLabel: { fontSize: 11, color: 'var(--text-2)', marginTop: 3, textTransform: 'uppercase' as const, letterSpacing: '0.8px' },
  }

  return (
    <div style={{ maxWidth: 860 }}>
      {/* Agent header */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', marginBottom: 28 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 14,
          background: 'var(--surface-3)', border: '1px solid var(--border-bright)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)', flexShrink: 0,
        }}>
          {agent.avatar_initials || agent.name.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text)', marginBottom: 2, letterSpacing: '-0.5px' }}>{agent.name}</h1>
          <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>{agent.role}</div>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6, margin: 0, maxWidth: 560 }}>{agent.description}</p>
        </div>
        <Link href={`/agents/${agentId}`} style={{ padding: '8px 18px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', textDecoration: 'none', flexShrink: 0 }}>
          Chat with {agent.name} →
        </Link>
      </div>

      {/* Stats row */}
      {stats && (
        <div style={{ ...S.panel }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {[
              { num: stats.totalConversations.toLocaleString(), label: 'Conversations' },
              { num: stats.totalContent.toLocaleString(), label: 'Drafts written' },
              { num: stats.totalKeywords.toLocaleString(), label: 'Keywords suggested' },
              { num: `${(stats.thisWeekTokens / 1000).toFixed(0)}k`, label: 'Tokens this week' },
              { num: `${(stats.thisMonthTokens / 1000).toFixed(0)}k`, label: 'Tokens this month' },
              { num: `$${stats.totalCost.toFixed(2)}`, label: 'Total cost (est.)' },
            ].map((s, i) => (
              <div key={s.label} style={{ ...S.stat, borderRight: i < 5 ? '1px solid var(--border)' : 'none' }}>
                <div style={S.statNum}>{s.num}</div>
                <div style={S.statLabel}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Client knowledge */}
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={S.panel}>
            <div style={S.panelHead}>
              <span>Client knowledge</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>What {agent.name} knows about each client</span>
            </div>
            {clients.map((client: any, i: number) => {
              const kn = knowledge.find((k: any) => k.client_id === client.id)
              const pageCount = kn?.site_pages?.length || 0
              const hasGsc = !!kn?.gsc_snapshot?.totals
              const hasDocs = (kn?.docs || []).length > 0
              const notes = kn?.agent_notes?.[agent.slug || 'ada']
              return (
                <div key={client.id} style={{ padding: '14px 18px', borderBottom: i < clients.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{client.name}</span>
                    <Link href={`/clients/${client.id}?tab=knowledge`} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>Edit knowledge →</Link>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                    {[
                      { label: `${pageCount} pages`, active: pageCount > 0 },
                      { label: 'GSC data', active: hasGsc },
                      { label: `${(kn?.docs || []).length} docs`, active: hasDocs },
                      { label: 'Agent notes', active: !!notes?.last_conversation },
                    ].map(tag => (
                      <span key={tag.label} style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 99,
                        background: tag.active ? 'rgba(79,127,255,0.12)' : 'var(--surface-2)',
                        color: tag.active ? 'var(--accent)' : 'var(--text-dim)',
                        border: `1px solid ${tag.active ? 'rgba(79,127,255,0.2)' : 'var(--border)'}`,
                      }}>{tag.label}</span>
                    ))}
                  </div>
                  {notes?.last_conversation && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '8px 10px' }}>
                      <span style={{ fontWeight: 600 }}>Last session: </span>{notes.last_conversation.summary}
                      {notes.last_conversation.pending?.length > 0 && (
                        <span style={{ color: 'var(--amber)', marginLeft: 8 }}>· {notes.last_conversation.pending.length} pending</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {clients.length === 0 && (
              <div style={{ padding: '24px 18px', fontSize: 13, color: 'var(--text-2)' }}>No clients yet. Add a client to start building knowledge.</div>
            )}
          </div>
        </div>

        {/* Current SEO intelligence */}
        {digest && (
          <div>
            <div style={S.panel}>
              <div style={S.panelHead}>
                <span>Current SEO intelligence</span>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>Week of {digest.week_of}</span>
              </div>
              <div style={{ padding: '14px 18px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, maxHeight: 240, overflowY: 'auto' as const }}>
                {digest.summary.slice(0, 600)}{digest.summary.length > 600 ? '...' : ''}
              </div>
            </div>
          </div>
        )}

        {/* Automations status */}
        <div>
          <div style={S.panel}>
            <div style={S.panelHead}>
              <span>Automations</span>
              <Link href={`/agents/${agentId}/automations`} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>Manage →</Link>
            </div>
            {automations.slice(0, 5).map((a: any, i: number) => (
              <div key={a.id} style={{ padding: '10px 18px', borderBottom: i < Math.min(4, automations.length - 1) ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', gap: 10, opacity: a.enabled ? 1 : 0.4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: a.enabled ? (a.last_run_status === 'error' ? 'var(--red)' : 'var(--green)') : 'var(--surface-3)' }} />
                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{a.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  {a.last_run_at ? fmtRel(a.last_run_at) : 'Never'}
                </span>
              </div>
            ))}
            {automations.length === 0 && (
              <div style={{ padding: '14px 18px', fontSize: 13, color: 'var(--text-2)' }}>No automations configured.</div>
            )}
          </div>
        </div>

        {/* Recent activity */}
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={S.panel}>
            <div style={S.panelHead}>
              <span>Recent activity</span>
              <Link href={`/agents/${agentId}/activity`} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>View all →</Link>
            </div>
            {recentActivity.slice(0, 8).map((a: any, i: number) => (
              <div key={a.id || i} style={{ display: 'flex', gap: 12, padding: '10px 18px', borderBottom: i < 7 ? '1px solid var(--border)' : 'none', alignItems: 'flex-start' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, marginTop: 5 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{(a.action || '').replace(/_/g, ' ')}</span>
                  {a.detail && <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail)}</div>}
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' as const }}>
                  {a.tokens_used > 0 && <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{a.tokens_used.toLocaleString()} tokens</div>}
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmtRel(a.created_at)}</div>
                </div>
              </div>
            ))}
            {recentActivity.length === 0 && <div style={{ padding: '24px 18px', fontSize: 13, color: 'var(--text-2)' }}>No activity yet.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
