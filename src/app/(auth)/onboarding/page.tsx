'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const steps = ['Workspace', 'API Key', 'Budget']

export default function Onboarding() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [workspaceName, setWorkspaceName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [budget, setBudget] = useState('500000')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function finish() {
    setSaving(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not signed in.'); setSaving(false); return }

    const { error } = await supabase.from('workspace_settings').upsert({
      user_id: user.id,
      workspace_name: workspaceName || 'My Workspace',
      anthropic_api_key: apiKey,
      monthly_token_budget: parseInt(budget) || 500000,
      onboarded: true,
    })

    if (error) { setError(error.message); setSaving(false); return }

    // Assign existing data to this user (for Dan's initial setup)
    await supabase.from('client_profiles').update({ user_id: user.id }).is('user_id', null)
    await supabase.from('agents').update({ user_id: user.id }).is('user_id', null)
    await supabase.from('content_queue').update({ user_id: user.id }).is('user_id', null)
    await supabase.from('content_outputs').update({ user_id: user.id }).is('user_id', null)
    await supabase.from('content_history').update({ user_id: user.id }).is('user_id', null)
    await supabase.from('keyword_banks').update({ user_id: user.id }).is('user_id', null)
    await supabase.from('conversations').update({ user_id: user.id }).is('user_id', null)
    await supabase.from('planned_tasks').update({ user_id: user.id }).is('user_id', null)
    await supabase.from('site_pages').update({ user_id: user.id }).is('user_id', null)

    router.push('/')
  }

  const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '36px 40px', width: '100%', maxWidth: 460 }
  const label: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.8px' }
  const hint: React.CSSProperties = { fontSize: 12, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }
  const btn: React.CSSProperties = { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '11px 24px', fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'var(--transition)' }
  const btnSecondary: React.CSSProperties = { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '11px 24px', fontSize: 14, cursor: 'pointer' }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ marginBottom: 40, textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--text)', marginBottom: 8 }}>Agencee</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 28 }}>Let's get your workspace ready</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {steps.map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: i <= step ? 'var(--accent)' : 'var(--surface-2)', border: `1px solid ${i <= step ? 'var(--accent)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: i <= step ? '#fff' : 'var(--text-muted)', fontWeight: 600, transition: 'var(--transition)' }}>
                {i < step ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 12, color: i === step ? 'var(--text)' : 'var(--text-muted)' }}>{s}</span>
              {i < steps.length - 1 && <div style={{ width: 32, height: 1, background: 'var(--border)', margin: '0 4px' }} />}
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        {step === 0 && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Name your workspace</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.6 }}>This is how your workspace will be identified. You can change it later.</p>
            <label style={label}>Workspace name</label>
            <input value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} placeholder="CNVRT Agency" autoFocus />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 28 }}>
              <button style={btn} onClick={() => setStep(1)}>Continue →</button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Anthropic API key</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.6 }}>Your key is stored securely and used only for your agents. Get one from <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>console.anthropic.com</a>.</p>
            <label style={label}>API key</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-ant-..." autoFocus />
            <p style={hint}>Your key never leaves your workspace. It is used to power your agents and content tasks.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 28 }}>
              <button style={btnSecondary} onClick={() => setStep(0)}>← Back</button>
              <button style={{ ...btn, opacity: !apiKey.trim() ? 0.5 : 1 }} onClick={() => setStep(2)} disabled={!apiKey.trim()}>Continue →</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Monthly token budget</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.6 }}>Set a hard limit on how many tokens your agents can use per month. This protects you from unexpected costs.</p>
            <label style={label}>Budget (tokens/month)</label>
            <select value={budget} onChange={e => setBudget(e.target.value)}>
              <option value="200000">200,000 tokens (~$2–6/mo)</option>
              <option value="500000">500,000 tokens (~$5–15/mo)</option>
              <option value="1000000">1,000,000 tokens (~$10–30/mo)</option>
              <option value="2000000">2,000,000 tokens (~$20–60/mo)</option>
              <option value="5000000">5,000,000 tokens (~$50–150/mo)</option>
            </select>
            <p style={hint}>Agents will stop and notify you when the budget is reached. You can adjust this at any time in Settings.</p>
            {error && <div style={{ fontSize: 13, color: 'var(--red)', background: 'var(--red-bg)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius)', padding: '10px 14px', marginTop: 14 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 28 }}>
              <button style={btnSecondary} onClick={() => setStep(1)}>← Back</button>
              <button style={{ ...btn, opacity: saving ? 0.6 : 1 }} onClick={finish} disabled={saving}>{saving ? 'Setting up...' : 'Launch workspace →'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
