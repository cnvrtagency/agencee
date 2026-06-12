'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { estimateBlendedCost } from '@/lib/pricing'

const S: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 20 },
  dayHead: { padding: '10px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' },
  row: { display: 'flex', gap: 14, alignItems: 'flex-start', padding: '12px 16px', borderBottom: '1px solid var(--border)' },
  dot: { width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, marginTop: 5 },
  action: { fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: 2 },
  detail: { fontSize: 13, color: 'var(--text)', lineHeight: 1.5 },
  meta: { fontSize: 11, color: 'var(--text-2)', marginTop: 3 },
}

const ACTION_COLOR: Record<string, string> = {
  content_created: 'var(--green)',
  keyword_suggestion: 'var(--accent)',
  suggest_keyword: 'var(--accent)',
  competitor_analysis: 'var(--amber)',
  internal_links_suggested: 'var(--purple, #8b5cf6)',
  chat: 'var(--border-bright)',
  content_plan: 'var(--green)',
  ada_briefing: 'var(--accent)',
  site_audit: 'var(--amber)',
  automation_weekly_knowledge_digest: 'var(--accent)',
  automation_proactive_gsc_briefing: 'var(--accent)',
  automation_weekly_keyword_scan: 'var(--accent)',
  automation_gsc_review: 'var(--accent)',
  automation_internal_link_audit: 'var(--amber)',
  automation_site_audit: 'var(--amber)',
  automation_competitor_analysis: 'var(--amber)',
  automation_monthly_content_plan: 'var(--green)',
  automation_performance_feedback: 'var(--green)',
  automation_content_decay_monitor: 'var(--amber)',
}

const ACTION_LABEL: Record<string, string> = {
  content_created: 'Draft saved',
  keyword_suggestion: 'Keyword suggested',
  suggest_keyword: 'Keyword suggested',
  competitor_analysis: 'Competitor analysis',
  internal_links_suggested: 'Internal links',
  chat: 'Chat session',
  content_plan: 'Content planned',
  ada_briefing: 'Briefing generated',
  site_audit: 'Site audit',
  competitor_crawl_summary: 'Competitor summaries',
  crawl_content_summary: 'Site summary',
  automation_weekly_knowledge_digest: 'Weekly knowledge digest',
  automation_proactive_gsc_briefing: 'Proactive GSC briefing',
  automation_weekly_keyword_scan: 'Weekly keyword scan',
  automation_gsc_review: 'GSC review',
  automation_internal_link_audit: 'Internal link audit',
  automation_site_audit: 'Site audit automation',
  automation_competitor_analysis: 'Competitor automation',
  automation_monthly_content_plan: 'Monthly content plan',
  automation_performance_feedback: 'Performance feedback',
  automation_content_decay_monitor: 'Content decay monitor',
}

function formatDetailValue(value: any): string {
  if (value == null) return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function renderDetail(action: string, detail: any) {
  let parsed: any = null
  if (typeof detail === 'string') {
    try { parsed = JSON.parse(detail) } catch { /* plain text detail */ }
  } else if (detail && typeof detail === 'object') {
    parsed = detail
  }

  if (!parsed) {
    return <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{String(detail || '—')}</span>
  }

  if (action === 'content_created' && parsed.title) {
    return (
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{parsed.title}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const }}>
          {parsed.primary_keyword && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)', background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>
              {parsed.primary_keyword}
            </span>
          )}
          {parsed.word_count && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{Number(parsed.word_count).toLocaleString()} words</span>}
        </div>
      </div>
    )
  }

  if ((action === 'keyword_suggestion' || action === 'suggest_keyword') && parsed.keyword) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{parsed.keyword}</span>
        {parsed.intent && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>
            {parsed.intent}
          </span>
        )}
      </div>
    )
  }

  if (action === 'competitor_analysis') {
    const label = parsed.competitor || parsed.competitors || parsed.client || 'competitors'
    return <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Analysed {formatDetailValue(label)}</span>
  }

  if (action === 'internal_links_suggested') {
    const count = parsed.count ?? (Array.isArray(parsed.links) ? parsed.links.length : null)
    return (
      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
        {count != null ? `${count} links suggested` : 'Internal link suggestions created'}{parsed.page ? ` for "${parsed.page}"` : ''}
      </span>
    )
  }

  if (action === 'chat') {
    return <span style={{ fontSize: 13, color: 'var(--text-dim)', fontStyle: 'italic' }}>Chat session</span>
  }

  if (action.startsWith('automation_') && parsed?.summary) {
    const summary = String(parsed.summary)
    const clipped = summary.length > 120 ? `${summary.slice(0, 120)}...` : summary
    const clients = Number(parsed.clients_processed || 0)
    return (
      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
        {clipped}{clients > 0 ? ` (${clients} client${clients === 1 ? '' : 's'} processed)` : ''}
      </span>
    )
  }

  const entries = Object.entries(parsed).slice(0, 4)
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
      {entries.map(([key, value]) => (
        <span key={key} style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          <span style={{ fontWeight: 600 }}>{key.replace(/_/g, ' ')}: </span>
          {formatDetailValue(value).slice(0, 60)}
        </span>
      ))}
    </div>
  )
}

export default function AgentActivityPage() {
  const { id: agentId } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<{ name: string } | null>(null)
  const [activity, setActivity] = useState<any[]>([])
  const [page, setPage] = useState(0)
  const [totalTokens, setTotalTokens] = useState(0)
  const PAGE_SIZE = 50

  useEffect(() => {
    supabase.from('agents').select('name').eq('id', agentId).single().then(({ data }) => setAgent(data))
  }, [agentId])

  useEffect(() => { load() }, [agentId, page])

  async function load() {
    const params = new URLSearchParams({ agent_id: agentId, page: String(page), page_size: String(PAGE_SIZE) })
    const res = await fetch(`/api/agent-activity?${params}`)
    const { data } = await res.json()
    setActivity(data || [])
    if (page === 0) {
      const totalsRes = await fetch(`/api/agent-activity?agent_id=${agentId}&totals_only=true`)
      const { data: totals } = await totalsRes.json()
      const sum = (totals || []).reduce((acc: number, r: any) => acc + (r.tokens_used || 0), 0)
      setTotalTokens(sum)
    }
  }

  // Group by day
  const byDay: Record<string, any[]> = {}
  activity.forEach(a => {
    const day = new Date(a.created_at).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(a)
  })

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{agent?.name ?? '...'}</div>
        <h1 style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.5px' }}>Activity</h1>
        {totalTokens > 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            {totalTokens.toLocaleString()} tokens used all-time · estimated cost <span style={{ fontFamily: 'var(--font-mono)' }}>${estimateBlendedCost(totalTokens).toFixed(2)}</span>
          </p>
        )}
      </div>

      {Object.keys(byDay).length === 0 && (
        <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>
          No activity recorded yet.
        </div>
      )}

      {Object.entries(byDay).map(([day, rows]) => (
        <div key={day} style={S.panel}>
          <div style={S.dayHead}>{day}</div>
          {rows.map((a, i) => {
            const label = ACTION_LABEL[a.action] || String(a.action || '').replace(/_/g, ' ')
            const dotColor = ACTION_COLOR[a.action] || 'var(--accent)'
            return (
              <div key={a.id} style={{ ...S.row, borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ ...S.dot, background: dotColor }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.action}>{label}</div>
                  <div style={S.detail}>{renderDetail(a.action, a.detail)}</div>
                  <div style={S.meta}>
                    {a.client_profiles?.name && <span>{a.client_profiles.name} · </span>}
                    {a.tokens_used > 0 && <span style={{ fontFamily: 'var(--font-mono)' }}>{a.tokens_used.toLocaleString()} tokens</span>}
                    {' · '}
                    {new Date(a.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 8 }}>
        {page > 0 && (
          <button onClick={() => setPage(p => p - 1)} style={{ padding: '7px 18px', borderRadius: 8, fontSize: 13, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer' }}>
            ← Previous
          </button>
        )}
        {activity.length === PAGE_SIZE && (
          <button onClick={() => setPage(p => p + 1)} style={{ padding: '7px 18px', borderRadius: 8, fontSize: 13, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer' }}>
            Next →
          </button>
        )}
      </div>
    </div>
  )
}
