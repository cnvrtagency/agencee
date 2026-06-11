'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Automation = {
  id: string
  agent_id: string
  automation_type: string
  name: string
  description: string | null
  enabled: boolean
  cadence: string
  run_day: string | null
  run_hour: number | null
  last_run_at: string | null
  last_run_status: string | null
  last_run_summary: string | null
  next_run_at: string | null
  config: Record<string, any>
  created_at: string
}

const SEO_DEFAULT_AUTOMATIONS: Omit<Automation, 'id' | 'agent_id' | 'created_at' | 'last_run_at' | 'last_run_status' | 'last_run_summary' | 'next_run_at'>[] = [
  { automation_type: 'weekly_keyword_scan', name: 'Weekly keyword scan', description: 'Scans the keyword bank for new opportunities and flags gaps in coverage.', enabled: true, cadence: 'weekly', run_day: 'monday', run_hour: 8, config: {} },
  { automation_type: 'monthly_content_plan', name: 'Monthly content plan', description: 'Generates a prioritised content plan for the coming month based on keyword data and gaps.', enabled: true, cadence: 'monthly', run_day: null, run_hour: 9, config: {} },
  { automation_type: 'competitor_analysis', name: 'Competitor analysis', description: 'Crawls competitor sites and summarises content gaps and opportunities.', enabled: false, cadence: 'monthly', run_day: null, run_hour: 10, config: {} },
  { automation_type: 'site_audit', name: 'Site audit', description: 'Full technical and content audit of the client site. Flags issues and prioritises fixes.', enabled: false, cadence: 'weekly', run_day: 'sunday', run_hour: 7, config: {} },
  { automation_type: 'gsc_review', name: 'GSC performance review', description: 'Reviews Search Console data for ranking drops, CTR improvements and quick wins.', enabled: true, cadence: 'weekly', run_day: 'monday', run_hour: 9, config: {} },
  { automation_type: 'internal_link_audit', name: 'Internal link audit', description: 'Finds internal linking opportunities across existing content and drafts a fix list.', enabled: false, cadence: 'monthly', run_day: null, run_hour: 8, config: {} },
]

function getNextRunAt(cadence: string, runDay: string | null, runHour: number): Date {
  const now = new Date()
  const next = new Date(now)
  next.setMinutes(0, 0, 0)
  next.setHours(runHour)
  if (cadence === 'daily') {
    if (next <= now) next.setDate(next.getDate() + 1)
  } else if (cadence === 'weekly') {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const targetDay = days.indexOf((runDay || 'monday').toLowerCase())
    const diff = (targetDay - now.getDay() + 7) % 7 || 7
    next.setDate(now.getDate() + diff)
  } else if (cadence === 'monthly') {
    next.setDate(1)
    next.setMonth(next.getMonth() + 1)
  }
  return next
}

export default function AutomationsPage() {
  const params = useParams()
  const id = params.id as string

  const [automations, setAutomations] = useState<Automation[]>([])
  const [togglingAutomation, setTogglingAutomation] = useState<string | null>(null)
  const [runningAutomation, setRunningAutomation] = useState<string | null>(null)

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  useEffect(() => {
    if (id) loadAutomations()
  }, [id])

  async function loadAutomations() {
    const { data } = await supabase.from('agent_automations').select('*').eq('agent_id', id).order('created_at')
    if (!data || data.length === 0) {
      const seeds = SEO_DEFAULT_AUTOMATIONS.map(a => ({
        ...a,
        agent_id: id,
        next_run_at: getNextRunAt(a.cadence, a.run_day, a.run_hour ?? 8).toISOString(),
      }))
      const { data: seeded } = await supabase.from('agent_automations').insert(seeds).select()
      setAutomations(seeded || [])
    } else {
      setAutomations(data)
    }
  }

  async function toggleAutomation(automationId: string, enabled: boolean) {
    setTogglingAutomation(automationId)
    const next = !enabled
    await supabase.from('agent_automations').update({ enabled: next }).eq('id', automationId)
    setAutomations(prev => prev.map(a => a.id === automationId ? { ...a, enabled: next } : a))
    setTogglingAutomation(null)
  }

  async function runAutomationNow(automation: Automation) {
    setRunningAutomation(automation.id)
    try {
      const res = await fetch('/api/intelligence/run-automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automation_id: automation.id, agent_id: id }),
      })
      const data = await res.json()
      const status = res.ok ? 'success' : 'error'
      const summary = data.summary || data.error || ''
      await supabase.from('agent_automations').update({
        last_run_at: new Date().toISOString(),
        last_run_status: status,
        last_run_summary: summary,
        next_run_at: getNextRunAt(automation.cadence, automation.run_day, automation.run_hour ?? 8).toISOString(),
      }).eq('id', automation.id)
      setAutomations(prev => prev.map(a => a.id === automation.id ? { ...a, last_run_at: new Date().toISOString(), last_run_status: status, last_run_summary: summary } : a))
    } catch (e: any) {
      const summary = e?.message || 'Failed'
      await supabase.from('agent_automations').update({ last_run_at: new Date().toISOString(), last_run_status: 'error', last_run_summary: summary }).eq('id', automation.id)
    } finally {
      setRunningAutomation(null)
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px', margin: 0 }}>Automations</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.6, marginBottom: 0 }}>Background tasks that run automatically on a schedule. Toggle them on or off, or run any immediately.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {automations.map(a => (
          <div key={a.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, opacity: a.enabled ? 1 : 0.65 }}>
            <button
              onClick={() => toggleAutomation(a.id, a.enabled)}
              disabled={togglingAutomation === a.id}
              style={{ flexShrink: 0, width: 36, height: 20, borderRadius: 99, border: 'none', cursor: 'pointer', background: a.enabled ? 'var(--brand)' : 'var(--border)', position: 'relative', transition: 'background 0.15s', padding: 0 }}
              title={a.enabled ? 'Disable' : 'Enable'}
            >
              <span style={{ position: 'absolute', top: 2, left: a.enabled ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', display: 'block' }} />
            </button>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{a.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'capitalize', fontFamily: 'var(--font-mono)' }}>{a.cadence}{a.run_day ? ` · ${a.run_day}` : ''}</span>
              </div>
              {a.description && <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>{a.description}</div>}
              <div style={{ display: 'flex', gap: 12, marginTop: 5, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                {a.last_run_at && (
                  <span style={{ color: a.last_run_status === 'error' ? 'var(--red, #f87171)' : a.last_run_status === 'success' ? 'var(--green)' : 'var(--text-dim)' }}>
                    Last: {fmt(a.last_run_at)} {a.last_run_status === 'error' ? '(error)' : a.last_run_status === 'success' ? '(ok)' : ''}
                  </span>
                )}
                {!a.last_run_at && <span>Never run</span>}
                {a.next_run_at && a.enabled && <span>Next: {fmt(a.next_run_at)}</span>}
              </div>
              {a.last_run_summary && (
                <div style={{ marginTop: 5, fontSize: 12, color: 'var(--text-2)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 520 }} title={a.last_run_summary}>
                  {a.last_run_summary}
                </div>
              )}
            </div>

            <button
              onClick={() => runAutomationNow(a)}
              disabled={runningAutomation === a.id}
              style={{ flexShrink: 0, fontSize: 12, fontWeight: 500, padding: '5px 10px', borderRadius: 'var(--radius)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {runningAutomation === a.id ? 'Running...' : 'Run now'}
            </button>
          </div>
        ))}
        {automations.length === 0 && (
          <div style={{ color: 'var(--text-2)', fontSize: 13.5, padding: '24px 0' }}>Loading automations...</div>
        )}
      </div>
    </div>
  )
}
