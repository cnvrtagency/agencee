'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const S: Record<string, React.CSSProperties> = {
  section: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '28px 32px', marginBottom: 20 },
  sectionHead: { fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4 },
  sectionSub: { fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.6 },
  label: { display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.8px' } as React.CSSProperties,
  field: { marginBottom: 20 },
  btn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '9px 20px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', transition: 'var(--transition)' } as React.CSSProperties,
  btnDanger: { background: 'transparent', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius)', padding: '9px 20px', fontSize: 13.5, cursor: 'pointer', transition: 'var(--transition)' } as React.CSSProperties,
}

export default function Settings() {
  const router = useRouter()
  const [workspaceName, setWorkspaceName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [budget, setBudget] = useState('500000')
  const [tokensUsed, setTokensUsed] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [userId, setUserId] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      const { data } = await supabase.from('workspace_settings').select('*').eq('user_id', user.id).maybeSingle()
      if (data) {
        setWorkspaceName(data.workspace_name || '')
        setApiKey(data.anthropic_api_key || '')
        setBudget(String(data.monthly_token_budget || 500000))
        setTokensUsed(data.tokens_used_this_month || 0)
      }
    }
    load()
  }, [])

  async function save() {
    setSaving(true); setSaved(false)
    await supabase.from('workspace_settings').upsert({
      user_id: userId,
      workspace_name: workspaceName,
      anthropic_api_key: apiKey,
      monthly_token_budget: parseInt(budget) || 500000,
      updated_at: new Date().toISOString(),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2500)
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
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Manage your workspace, API keys, and usage limits.</p>
      </div>

      {/* Workspace */}
      <div style={S.section}>
        <div style={S.sectionHead}>Workspace</div>
        <div style={S.sectionSub}>How your workspace appears in the app.</div>
        <div style={S.field}>
          <label style={S.label}>Workspace name</label>
          <input value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} placeholder="My Agency" />
        </div>
      </div>

      {/* API key */}
      <div style={S.section}>
        <div style={S.sectionHead}>Anthropic API key</div>
        <div style={S.sectionSub}>Used to power all your agents. Your key is stored securely and never shared.</div>
        <div style={S.field}>
          <label style={S.label}>API key</label>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-ant-..." />
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
        {/* Current usage */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Used this month</span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: usagePct >= 70 ? usageBar : 'var(--text-muted)' }}>
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
