'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const S: Record<string, React.CSSProperties> = {
  section: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '28px 32px', marginBottom: 20 },
  sectionHead: { fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4 },
  sectionSub: { fontSize: 13, color: 'var(--text-2)', marginBottom: 24, lineHeight: 1.6 },
  label: { display: 'block', fontSize: 11, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.8px' } as React.CSSProperties,
  field: { marginBottom: 20 },
  btn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '9px 20px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', transition: 'var(--transition)' } as React.CSSProperties,
  btnDanger: { background: 'transparent', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius)', padding: '9px 20px', fontSize: 13.5, cursor: 'pointer', transition: 'var(--transition)' } as React.CSSProperties,
}

export default function Settings() {
  const router = useRouter()
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [budget, setBudget] = useState('500000')
  const [tokensUsed, setTokensUsed] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [userId, setUserId] = useState('')

  // Notification preferences
  const [notifPrefs, setNotifPrefs] = useState({
    email_enabled: true,
    slack_webhook_url: '',
    notify_output_ready: true,
    notify_ranking_changes: true,
    notify_schedule_complete: true,
    notify_schedule_failed: true,
    notify_ranking_threshold: 3,
  })
  const [testingSlack, setTestingSlack] = useState(false)
  const [slackTestMsg, setSlackTestMsg] = useState('')
  const [savingNotif, setSavingNotif] = useState(false)
  const [savedNotif, setSavedNotif] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      // Load workspace
      const { data: ws } = await supabase.from('workspaces').select('id,name').eq('owner_id', user.id).maybeSingle()
      if (ws) {
        setWorkspaceId(ws.id)
        setWorkspaceName(ws.name || '')
      }

      // Load workspace settings (API keys, budget)
      const { data } = await supabase.from('workspace_settings').select('*').eq('user_id', user.id).maybeSingle()
      if (data) {
        setApiKey(data.anthropic_api_key || '')
        setGeminiKey(data.gemini_api_key || '')
        setBudget(String(data.monthly_token_budget || 500000))
        setTokensUsed(data.tokens_used_this_month || 0)
      }

      // Load notification preferences
      if (ws?.id) {
        const { data: np } = await supabase.from('notification_preferences').select('*').eq('workspace_id', ws.id).maybeSingle()
        if (np) setNotifPrefs(prev => ({ ...prev, ...np }))
      }
    }
    load()
  }, [])

  async function save() {
    setSaving(true); setSaved(false)
    // Update workspace name in workspaces table
    if (workspaceId) {
      await supabase.from('workspaces').update({ name: workspaceName }).eq('id', workspaceId)
    }
    // Save encrypted API keys via server route
    if (userId) {
      await fetch('/api/workspace/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          workspace_id: workspaceId || undefined,
          anthropic_api_key: apiKey,
          gemini_api_key: geminiKey || null,
        }),
      })
    }
    // Update budget + workspace name in workspace_settings
    await supabase.from('workspace_settings').upsert({
      user_id: userId,
      workspace_id: workspaceId || undefined,
      workspace_name: workspaceName,
      monthly_token_budget: parseInt(budget) || 500000,
      updated_at: new Date().toISOString(),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function saveNotifications() {
    if (!workspaceId) return
    setSavingNotif(true); setSavedNotif(false)
    await supabase.from('notification_preferences').upsert({
      workspace_id: workspaceId,
      ...notifPrefs,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id' })
    setSavingNotif(false); setSavedNotif(true)
    setTimeout(() => setSavedNotif(false), 2500)
  }

  async function testSlack() {
    if (!notifPrefs.slack_webhook_url) return
    setTestingSlack(true); setSlackTestMsg('')
    try {
      const res = await fetch(notifPrefs.slack_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Test message from Agencee — your Slack notifications are working!' }),
      })
      setSlackTestMsg(res.ok ? 'Test sent!' : 'Failed — check the webhook URL')
    } catch { setSlackTestMsg('Failed — check the webhook URL') }
    setTestingSlack(false)
    setTimeout(() => setSlackTestMsg(''), 3000)
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const budget_n = parseInt(budget) || 500000
  const usagePct = budget_n > 0 ? Math.min(100, Math.round((tokensUsed / budget_n) * 100)) : 0
  const usageBar = usagePct >= 90 ? 'var(--red)' : usagePct >= 70 ? 'var(--amber)' : 'var(--green)'

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, color: 'var(--text)', marginBottom: 6 }}>Settings</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Manage your workspace, API keys, and usage limits.</p>
      </div>

      {/* Workspace */}
      <div style={S.section}>
        <div style={S.sectionHead}>Workspace</div>
        <div style={S.sectionSub}>How your workspace appears in the app.</div>
        <div style={S.field}>
          <label style={S.label}>Workspace name</label>
          <input value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} placeholder="My Agency" />
        </div>
        {workspaceId && (
          <div>
            <label style={S.label}>Workspace ID</label>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px', letterSpacing: '0.3px', userSelect: 'all' as const }}>
              {workspaceId}
            </div>
          </div>
        )}
      </div>

      {/* Anthropic API key */}
      <div style={S.section}>
        <div style={S.sectionHead}>Anthropic API key</div>
        <div style={S.sectionSub}>Powers all your agents. Stored securely and never shared.</div>
        <div style={S.field}>
          <label style={S.label}>API key</label>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-ant-..." />
        </div>
      </div>

      {/* Gemini API key */}
      <div style={S.section}>
        <div style={S.sectionHead}>Google Gemini API key</div>
        <div style={S.sectionSub}>Optional. Used for additional AI capabilities when available.</div>
        <div style={S.field}>
          <label style={S.label}>Gemini API key</label>
          <input type="password" value={geminiKey} onChange={e => setGeminiKey(e.target.value)} placeholder="AIza..." />
        </div>
      </div>

      {/* Token budget */}
      <div style={S.section}>
        <div style={S.sectionHead}>Monthly token budget</div>
        <div style={S.sectionSub}>Agents stop when this limit is reached. Resets on the 1st of each month.</div>
        <div style={S.field}>
          <label style={S.label}>Budget</label>
          <select value={budget} onChange={e => setBudget(e.target.value)}>
            <option value="200000">200,000 tokens (~$2–6/mo)</option>
            <option value="500000">500,000 tokens (~$5–15/mo)</option>
            <option value="1000000">1,000,000 tokens (~$10–30/mo)</option>
            <option value="2000000">2,000,000 tokens (~$20–60/mo)</option>
            <option value="5000000">5,000,000 tokens (~$50–150/mo)</option>
          </select>
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Used this month</span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: usagePct >= 70 ? usageBar : 'var(--text-2)' }}>
              {(tokensUsed / 1000).toFixed(0)}k / {(budget_n / 1000).toFixed(0)}k ({usagePct}%)
            </span>
          </div>
          <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${usagePct}%`, background: usageBar, borderRadius: 99, transition: 'width 0.8s var(--ease)' }} />
          </div>
          {usagePct >= 90 && (
            <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>You are near your monthly limit. Increase your budget or agents will stop responding.</p>
          )}
        </div>
      </div>

      {/* Notifications */}
      <div style={S.section}>
        <div style={S.sectionHead}>Notifications</div>
        <div style={S.sectionSub}>Get notified when Ada produces content, rankings change, or schedules run.</div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Email notifications</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Sent to your account email address</div>
          </div>
          <div onClick={() => setNotifPrefs(p => ({ ...p, email_enabled: !p.email_enabled }))} style={{ width: 36, height: 20, borderRadius: 99, background: notifPrefs.email_enabled ? 'var(--accent)' : 'var(--surface-3)', position: 'relative', transition: 'background 0.2s', cursor: 'pointer', border: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ position: 'absolute', top: 2, left: notifPrefs.email_enabled ? 17 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </div>
        </div>

        <div style={S.field}>
          <label style={S.label}>Slack webhook URL</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={notifPrefs.slack_webhook_url} onChange={e => setNotifPrefs(p => ({ ...p, slack_webhook_url: e.target.value }))} placeholder="https://hooks.slack.com/services/..." style={{ flex: 1 }} />
            <button style={{ ...S.btn, background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)', padding: '9px 14px', fontSize: 13 }} onClick={testSlack} disabled={testingSlack || !notifPrefs.slack_webhook_url}>{testingSlack ? 'Sending...' : 'Test'}</button>
          </div>
          {slackTestMsg && <div style={{ fontSize: 12, color: slackTestMsg.includes('Failed') ? 'var(--red)' : 'var(--green)', marginTop: 6 }}>{slackTestMsg}</div>}
        </div>

        <div style={S.field}>
          <label style={S.label}>Ranking change threshold (positions)</label>
          <input type="number" value={notifPrefs.notify_ranking_threshold} onChange={e => setNotifPrefs(p => ({ ...p, notify_ranking_threshold: parseInt(e.target.value) || 3 }))} style={{ width: 80 }} min={1} max={20} />
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>Notify when a keyword drops more than this many positions.</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { key: 'notify_output_ready', label: 'Content ready for review', desc: 'When Ada produces a new draft' },
            { key: 'notify_ranking_changes', label: 'Ranking changes', desc: 'When keyword positions change significantly' },
            { key: 'notify_schedule_complete', label: 'Schedule complete', desc: 'When an autonomous schedule runs successfully' },
            { key: 'notify_schedule_failed', label: 'Schedule failed', desc: 'When a scheduled run encounters an error' },
          ].map(({ key, label, desc }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{desc}</div>
              </div>
              <div onClick={() => setNotifPrefs(p => ({ ...p, [key]: !(p as any)[key] }))} style={{ width: 36, height: 20, borderRadius: 99, background: (notifPrefs as any)[key] ? 'var(--accent)' : 'var(--surface-3)', position: 'relative', transition: 'background 0.2s', cursor: 'pointer', border: '1px solid var(--border)', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 2, left: (notifPrefs as any)[key] ? 17 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
          <button style={S.btn} onClick={saveNotifications} disabled={savingNotif}>{savingNotif ? 'Saving...' : 'Save notification settings'}</button>
          {savedNotif && <span style={{ fontSize: 13, color: 'var(--green)' }}>Saved</span>}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button style={S.btn} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
        {saved && <span style={{ fontSize: 13, color: 'var(--green)' }}>Saved</span>}
        <div style={{ flex: 1 }} />
        <button style={S.btnDanger} onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}
