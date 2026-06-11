'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getOrCreateWorkspace } from '@/lib/workspace'

// Steps: 0=Welcome, 1=Add client, 2=Connect site, 3=Crawling, 4=Meet Ada
const STEP_LABELS = ['Welcome', 'Add client', 'Connect site', 'Site ready', 'Meet Ada']

export default function Onboarding() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [workspaceId, setWorkspaceId] = useState('')
  const [clientName, setClientName] = useState('')
  const [website, setWebsite] = useState('')
  const [industry, setIndustry] = useState('')
  const [clientId, setClientId] = useState('')
  const [pagesCrawled, setPagesCrawled] = useState(0)
  const [crawling, setCrawling] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }
      const wsId = await getOrCreateWorkspace()
      setWorkspaceId(wsId)
    }
    init()
  }, [router])

  async function addClient() {
    if (!clientName.trim() || !website.trim()) { setError('Client name and website are required.'); return }
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const slug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const { data, error: err } = await supabase.from('client_profiles').insert({
      workspace_id: workspaceId || null,
      user_id: user.id,
      name: clientName.trim(),
      slug,
      website: website.trim().startsWith('http') ? website.trim() : `https://${website.trim()}`,
      industry: industry.trim() || null,
    }).select().single()
    if (err || !data) { setError(err?.message || 'Failed to create client'); return }
    setClientId(data.id)
    setStep(2)
  }

  async function crawlSite() {
    if (!clientId || !website) return
    setCrawling(true); setError('')
    setStep(3)
    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, website: website.trim().startsWith('http') ? website.trim() : `https://${website.trim()}` }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); setCrawling(false); setStep(2); return }
      setPagesCrawled(data.pages_crawled || 0)
      setCrawling(false)
      setStep(4)
    } catch (e: any) {
      setError(e.message || 'Crawl failed')
      setCrawling(false)
      setStep(2)
    }
  }

  async function finish() {
    // Mark onboarding complete
    if (workspaceId) {
      await supabase.from('workspace_settings').update({ onboarding_completed: true }).eq('workspace_id', workspaceId)
    }
    router.push('/agents')
  }

  const S: Record<string, React.CSSProperties> = {
    wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px' },
    card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '48px 56px', width: '100%', maxWidth: 480 },
    steps: { display: 'flex', gap: 6, marginBottom: 40 },
    h1: { fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, color: 'var(--text)', marginBottom: 8, lineHeight: 1.2 } as React.CSSProperties,
    sub: { fontSize: 14, color: 'var(--text-2)', marginBottom: 32, lineHeight: 1.6 } as React.CSSProperties,
    label: { display: 'block', fontSize: 11, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.8px' } as React.CSSProperties,
    field: { marginBottom: 20 } as React.CSSProperties,
    btn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '11px 28px', fontSize: 14, fontWeight: 500, cursor: 'pointer', width: '100%' } as React.CSSProperties,
    btnSecondary: { background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '11px 28px', fontSize: 14, cursor: 'pointer', width: '100%' } as React.CSSProperties,
    errBox: { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius)', padding: '10px 14px', color: 'var(--red)', marginBottom: 16, fontSize: 13 } as React.CSSProperties,
  }

  function dot(i: number): React.CSSProperties {
    const active = i === Math.min(step, 4)
    const done = i < step
    return {
      width: active ? 24 : 8,
      height: 8,
      borderRadius: 99,
      background: done || active ? 'var(--accent)' : 'var(--surface-3)',
      transition: 'all 0.3s',
    }
  }

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        {/* Step indicators */}
        <div style={S.steps}>
          {STEP_LABELS.map((_, i) => (
            <div key={i} style={dot(i)} />
          ))}
        </div>

        {step === 0 && (
          <>
            <div style={{ fontSize: 40, marginBottom: 16 }}>👋</div>
            <h1 style={S.h1}>Welcome to Agencee</h1>
            <p style={S.sub}>Your AI-powered SEO platform. Let's set up your first client in under 2 minutes.</p>
            <button style={S.btn} onClick={() => setStep(1)}>Get started →</button>
          </>
        )}

        {step === 1 && (
          <>
            <h1 style={S.h1}>Add your first client</h1>
            <p style={S.sub}>Tell Ada who she's working for.</p>
            {error && <div style={S.errBox}>{error}</div>}
            <div style={S.field}>
              <label style={S.label}>Business name</label>
              <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Acme Dental" />
            </div>
            <div style={S.field}>
              <label style={S.label}>Website URL</label>
              <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://acmedental.com" />
            </div>
            <div style={S.field}>
              <label style={S.label}>Industry (optional)</label>
              <input value={industry} onChange={e => setIndustry(e.target.value)} placeholder="Dental practice" />
            </div>
            <button style={S.btn} onClick={addClient}>Continue →</button>
          </>
        )}

        {step === 2 && (
          <>
            <h1 style={S.h1}>Connect your site</h1>
            <p style={S.sub}>Ada will crawl <strong>{website}</strong> to understand your content, pages, and structure.</p>
            {error && <div style={S.errBox}>{error}</div>}
            <button style={S.btn} onClick={crawlSite}>Crawl site now →</button>
            <button style={{ ...S.btnSecondary, marginTop: 10 }} onClick={() => setStep(4)}>Skip for now</button>
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 36, marginBottom: 20 }}>⏳</div>
              <h1 style={S.h1}>Crawling your site…</h1>
              <p style={S.sub}>Ada is reading your pages. This takes about 30 seconds.</p>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            {pagesCrawled > 0 ? (
              <>
                <div style={{ fontSize: 36, marginBottom: 16 }}>✅</div>
                <h1 style={S.h1}>Site connected</h1>
                <p style={S.sub}>Ada has read <strong>{pagesCrawled} pages</strong> from your site. She now understands your content structure.</p>
              </>
            ) : (
              <>
                <div style={{ fontSize: 36, marginBottom: 16 }}>👋</div>
                <h1 style={S.h1}>You're almost set</h1>
                <p style={S.sub}>You can crawl your site from the client page at any time.</p>
              </>
            )}
            <button style={S.btn} onClick={finish}>Meet Ada →</button>
          </>
        )}
      </div>
    </div>
  )
}
