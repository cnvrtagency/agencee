'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Client, Keyword } from '@/lib/types'

type SitePage = {
  id: string; url: string; title: string | null; h1: string | null
  meta_description: string | null; word_count: number | null
  content_summary: string | null; crawled_at: string
}

const S = {
  h1: { fontSize: 26, fontWeight: 600, color: '#E2E4EE', marginBottom: 4 } as React.CSSProperties,
  sub: { fontSize: 14, color: '#8B91A8', marginBottom: 24 } as React.CSSProperties,
  panel: { background: '#141720', border: '1px solid #252836', borderRadius: 10, overflow: 'hidden', marginBottom: 24 } as React.CSSProperties,
  panelHead: { padding: '14px 20px', borderBottom: '1px solid #252836', fontSize: 12, fontWeight: 600, color: '#8B91A8', textTransform: 'uppercase' as const, letterSpacing: '1px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  field: { padding: '16px 20px', borderBottom: '1px solid #1C1F2A' } as React.CSSProperties,
  fieldLabel: { fontSize: 11, color: '#8B91A8', textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: 6 },
  fieldVal: { fontSize: 14, color: '#E2E4EE', lineHeight: 1.6 },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#8B91A8', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '12px 16px', borderBottom: '1px solid #252836' },
  td: { padding: '12px 16px', fontSize: 13, borderBottom: '1px solid #1C1F2A', verticalAlign: 'top' as const },
  btn: { background: '#6366F1', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  btnSm: { background: '#1C1F2A', color: '#8B91A8', border: '1px solid #252836', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { background: '#141720', border: '1px solid #252836', borderRadius: 12, padding: 28, width: '100%', maxWidth: 520 },
  label: { fontSize: 12, fontWeight: 500, color: '#8B91A8', marginBottom: 6, display: 'block', textTransform: 'uppercase' as const, letterSpacing: '0.8px' },
  inputRow: { display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, marginBottom: 14 } as React.CSSProperties,
}

const intentColor: Record<string, string> = {
  informational: '#6366F1', commercial: '#F59E0B', transactional: '#34D399', navigational: '#8B91A8',
}

const blankKw = { keyword: '', cluster: '', intent: 'informational', funnel_stage: 'tofu', monthly_volume: '', difficulty: '', priority: '5' }

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const [client, setClient] = useState<Client | null>(null)
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [sitePages, setSitePages] = useState<SitePage[]>([])
  const [kwOpen, setKwOpen] = useState(false)
  const [kw, setKw] = useState(blankKw)
  const [saving, setSaving] = useState(false)
  const [crawling, setCrawling] = useState(false)
  const [crawlError, setCrawlError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [syncSuccess, setSyncSuccess] = useState('')
  const [activeTab, setActiveTab] = useState<'profile' | 'keywords' | 'pages' | 'codebase'>('profile')
  const [expandedPage, setExpandedPage] = useState<string | null>(null)
  const [githubForm, setGithubForm] = useState({ github_repo: '', github_branch: '', github_token: '' })
  const [savingGithub, setSavingGithub] = useState(false)

  useEffect(() => {
    if (!id) return
    loadClient()
    loadKw()
    loadPages()
  }, [id])

  async function loadClient() {
    const { data } = await supabase.from('client_profiles').select('*').eq('id', id).single()
    if (data) {
      setClient(data)
      setGithubForm({
        github_repo: (data as any).github_repo || '',
        github_branch: (data as any).github_branch || 'main',
        github_token: (data as any).github_token || '',
      })
    }
  }

  async function loadKw() {
    const { data } = await supabase.from('keyword_banks').select('*').eq('client_id', id).order('priority').order('keyword')
    setKeywords(data || [])
  }

  async function loadPages() {
    const { data } = await supabase.from('site_pages').select('id,url,title,h1,meta_description,word_count,content_summary,crawled_at').eq('client_id', id).order('url')
    setSitePages(data || [])
  }

  async function crawl() {
    if (!client?.website) { setCrawlError('No website URL set on this client profile.'); return }
    setCrawling(true); setCrawlError('')
    try {
      const res = await fetch('/api/crawl', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: id, website: client.website }),
      })
      const data = await res.json()
      if (data.error) setCrawlError(data.error)
      else { loadClient(); loadPages(); setActiveTab('pages') }
    } catch { setCrawlError('Crawl failed.') }
    setCrawling(false)
  }

  async function saveGithub() {
    setSavingGithub(true)
    await supabase.from('client_profiles').update({
      github_repo: githubForm.github_repo,
      github_branch: githubForm.github_branch || 'main',
      github_token: githubForm.github_token,
    }).eq('id', id)
    setSavingGithub(false)
    loadClient()
  }

  async function syncRepo() {
    setSyncing(true); setSyncError(''); setSyncSuccess('')
    try {
      const res = await fetch('/api/github', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: id }),
      })
      const data = await res.json()
      if (data.error) setSyncError(data.error)
      else { setSyncSuccess(`Synced ${data.total_files} files`); loadClient() }
    } catch { setSyncError('Sync failed.') }
    setSyncing(false)
  }

  async function saveKw() {
    if (!kw.keyword.trim()) return
    setSaving(true)
    await supabase.from('keyword_banks').insert({
      client_id: id, keyword: kw.keyword, cluster: kw.cluster || null, intent: kw.intent,
      funnel_stage: kw.funnel_stage, monthly_volume: kw.monthly_volume ? parseInt(kw.monthly_volume) : null,
      difficulty: kw.difficulty ? parseInt(kw.difficulty) : null, priority: parseInt(kw.priority),
    })
    setSaving(false); setKwOpen(false); setKw(blankKw); loadKw()
  }

  if (!client) return <div style={{ color: '#8B91A8', fontSize: 14 }}>Loading...</div>

  const profileFields = [
    { key: 'description', label: 'Description' },
    { key: 'icp', label: 'Ideal customer' },
    { key: 'usp', label: 'USP' },
    { key: 'brand_voice', label: 'Brand voice' },
    { key: 'content_goals', label: 'Content goals' },
  ]

  const fileTree = (client as any).file_tree
  const githubSyncedAt = (client as any).github_synced_at

  const tabs = [
    { key: 'profile', label: 'Profile' },
    { key: 'keywords', label: `Keywords (${keywords.length})` },
    { key: 'pages', label: `Site pages (${sitePages.length})` },
    { key: 'codebase', label: fileTree ? 'Codebase ✓' : 'Codebase' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <h1 style={S.h1}>{client.name}</h1>
          <p style={S.sub}>
            {client.industry}
            {client.website && <> · <a href={client.website} target="_blank" rel="noreferrer" style={{ color: '#6366F1' }}>{client.website}</a></>}
            {(client as any).last_crawled_at && <span style={{ color: '#8B91A8' }}> · Crawled {new Date((client as any).last_crawled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
            {githubSyncedAt && <span style={{ color: '#8B91A8' }}> · Repo synced {new Date(githubSyncedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {crawlError && <span style={{ fontSize: 12, color: '#F87171' }}>{crawlError}</span>}
          <button style={{ ...S.btnSm }} onClick={crawl} disabled={crawling}>{crawling ? 'Crawling...' : sitePages.length > 0 ? 'Re-crawl' : 'Crawl site'}</button>
          {(client as any).github_repo && (
            <button style={{ ...S.btnSm, color: syncing ? '#8B91A8' : '#34D399', borderColor: syncing ? '#252836' : '#34D39940' }} onClick={syncRepo} disabled={syncing}>
              {syncing ? 'Syncing...' : fileTree ? 'Re-sync repo' : 'Sync repo'}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key as any)} style={{ padding: '7px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer', border: 'none', background: activeTab === t.key ? '#6366F1' : '#1C1F2A', color: activeTab === t.key ? '#fff' : '#8B91A8', fontWeight: activeTab === t.key ? 500 : 400 }}>{t.label}</button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <div style={S.panel}>
          <div style={S.panelHead}><span>Client profile</span></div>
          {profileFields.map(({ key, label }) => {
            const val = (client as any)[key]
            if (!val) return null
            return (
              <div key={key} style={S.field}>
                <div style={S.fieldLabel}>{label}</div>
                <div style={S.fieldVal}>{val}</div>
              </div>
            )
          })}
        </div>
      )}

      {activeTab === 'keywords' && (
        <div style={S.panel}>
          <div style={S.panelHead}>
            <span>Keyword bank ({keywords.length})</span>
            <button style={S.btn} onClick={() => setKwOpen(true)}>+ Add keyword</button>
          </div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Keyword</th>
                <th style={S.th}>Cluster</th>
                <th style={S.th}>Intent</th>
                <th style={S.th}>Stage</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Vol</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>KD</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Pos</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Pri</th>
              </tr>
            </thead>
            <tbody>
              {keywords.map(k => (
                <tr key={k.id}>
                  <td style={{ ...S.td, color: '#E2E4EE', fontWeight: 500 }}>{k.keyword}</td>
                  <td style={{ ...S.td, color: '#8B91A8' }}>{k.cluster || '—'}</td>
                  <td style={S.td}>{k.intent && <span style={{ fontSize: 11, fontWeight: 600, color: intentColor[k.intent] || '#8B91A8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{k.intent}</span>}</td>
                  <td style={{ ...S.td, color: '#8B91A8', textTransform: 'uppercase', fontSize: 11, fontWeight: 600 }}>{k.funnel_stage || '—'}</td>
                  <td style={{ ...S.td, color: '#8B91A8', textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>{k.monthly_volume?.toLocaleString() || '—'}</td>
                  <td style={{ ...S.td, color: '#8B91A8', textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>{k.difficulty ?? '—'}</td>
                  <td style={{ ...S.td, color: k.current_position ? '#34D399' : '#8B91A8', textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>{k.current_position ?? '—'}</td>
                  <td style={{ ...S.td, color: '#8B91A8', textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>{k.priority}</td>
                </tr>
              ))}
              {keywords.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: '#8B91A8', textAlign: 'center', padding: '32px 16px' }}>No keywords yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'pages' && (
        <div style={S.panel}>
          <div style={S.panelHead}>
            <span>Site pages ({sitePages.length})</span>
          </div>
          {sitePages.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#E2E4EE', marginBottom: 8 }}>No pages crawled yet</div>
              <button style={S.btn} onClick={crawl} disabled={crawling}>{crawling ? 'Crawling...' : 'Crawl site now'}</button>
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>URL</th>
                  <th style={S.th}>Title / H1</th>
                  <th style={S.th}>Summary</th>
                  <th style={S.th}>Meta</th>
                  <th style={{ ...S.th, textAlign: 'right' as const }}>Words</th>
                </tr>
              </thead>
              <tbody>
                {sitePages.map(p => (
                  <tr key={p.id} onClick={() => setExpandedPage(expandedPage === p.id ? null : p.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...S.td, maxWidth: 160 }}>
                      <a href={p.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#6366F1', fontSize: 12, fontFamily: '"JetBrains Mono",monospace', wordBreak: 'break-all' }}>
                        {p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                      </a>
                    </td>
                    <td style={{ ...S.td, maxWidth: 180 }}>
                      <div style={{ color: '#E2E4EE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || '—'}</div>
                      {p.h1 && p.h1 !== p.title && <div style={{ color: '#8B91A8', fontSize: 12 }}>H1: {p.h1}</div>}
                    </td>
                    <td style={{ ...S.td, color: '#8B91A8', fontSize: 12, maxWidth: 220 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expandedPage === p.id ? 'normal' : 'nowrap' }}>{p.content_summary || '—'}</div>
                    </td>
                    <td style={{ ...S.td, maxWidth: 200, fontSize: 12 }}>
                      {p.meta_description
                        ? <div style={{ color: '#8B91A8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expandedPage === p.id ? 'normal' : 'nowrap' }}>{p.meta_description}</div>
                        : <span style={{ color: '#F87171', fontSize: 11, fontWeight: 600 }}>MISSING</span>
                      }
                    </td>
                    <td style={{ ...S.td, color: '#8B91A8', textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>{p.word_count?.toLocaleString() || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'codebase' && (
        <div>
          {/* GitHub config */}
          <div style={S.panel}>
            <div style={S.panelHead}><span>GitHub repository</span></div>
            <div style={{ padding: '20px' }}>
              <p style={{ fontSize: 13, color: '#8B91A8', marginBottom: 20, lineHeight: 1.6 }}>
                Connect a GitHub repo so Ada can read the codebase structure and — once the publish agent is built — commit new content directly to the repo.
              </p>
              <div style={S.field}>
                <label style={S.label}>Repository URL</label>
                <input value={githubForm.github_repo} onChange={e => setGithubForm(f => ({ ...f, github_repo: e.target.value }))} placeholder="https://github.com/owner/repo" />
              </div>
              <div style={S.inputRow}>
                <div>
                  <label style={S.label}>Branch</label>
                  <input value={githubForm.github_branch} onChange={e => setGithubForm(f => ({ ...f, github_branch: e.target.value }))} placeholder="main" />
                </div>
              </div>
              <div style={S.field}>
                <label style={S.label}>Personal access token</label>
                <input type="password" value={githubForm.github_token} onChange={e => setGithubForm(f => ({ ...f, github_token: e.target.value }))} placeholder="ghp_..." />
                <div style={{ fontSize: 11, color: '#5A6070', marginTop: 6 }}>Stored securely. Needs repo read/write access.</div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button style={S.btn} onClick={saveGithub} disabled={savingGithub}>{savingGithub ? 'Saving...' : 'Save'}</button>
                {(client as any).github_repo && (
                  <button style={{ ...S.btn, background: '#1C1F2A', color: '#34D399', border: '1px solid #34D39940' }} onClick={syncRepo} disabled={syncing}>
                    {syncing ? 'Syncing...' : 'Sync file tree'}
                  </button>
                )}
                {syncError && <span style={{ fontSize: 12, color: '#F87171' }}>{syncError}</span>}
                {syncSuccess && <span style={{ fontSize: 12, color: '#34D399' }}>{syncSuccess}</span>}
              </div>
            </div>
          </div>

          {/* File tree */}
          {fileTree ? (
            <div style={S.panel}>
              <div style={S.panelHead}>
                <span>File tree</span>
                <span style={{ fontSize: 11, color: '#8B91A8', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                  Synced {githubSyncedAt ? new Date(githubSyncedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <pre style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 12, color: '#8B91A8', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {fileTree}
                </pre>
              </div>
            </div>
          ) : (client as any).github_repo ? (
            <div style={{ ...S.panel, padding: '32px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: '#8B91A8', marginBottom: 16 }}>Repo saved. Sync the file tree to give Ada visibility into the codebase structure.</div>
              <button style={S.btn} onClick={syncRepo} disabled={syncing}>{syncing ? 'Syncing...' : 'Sync file tree now'}</button>
            </div>
          ) : (
            <div style={{ ...S.panel, padding: '32px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: '#8B91A8' }}>Add a GitHub repo above to give Ada codebase access.</div>
            </div>
          )}
        </div>
      )}

      {kwOpen && (
        <div style={S.overlay} onClick={() => setKwOpen(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20, color: '#E2E4EE' }}>Add keyword</h2>
            {[{ key: 'keyword', label: 'Keyword' }, { key: 'cluster', label: 'Cluster' }].map(({ key, label }) => (
              <div key={key} style={{ marginBottom: 14 }}>
                <label style={S.label}>{label}</label>
                <input value={(kw as any)[key]} onChange={e => setKw(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={S.label}>Intent</label>
                <select value={kw.intent} onChange={e => setKw(f => ({ ...f, intent: e.target.value }))}>
                  <option value="informational">Informational</option>
                  <option value="commercial">Commercial</option>
                  <option value="transactional">Transactional</option>
                  <option value="navigational">Navigational</option>
                </select>
              </div>
              <div>
                <label style={S.label}>Funnel stage</label>
                <select value={kw.funnel_stage} onChange={e => setKw(f => ({ ...f, funnel_stage: e.target.value }))}>
                  <option value="tofu">ToFu</option>
                  <option value="mofu">MoFu</option>
                  <option value="bofu">BoFu</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
              {[{ key: 'monthly_volume', label: 'Volume' }, { key: 'difficulty', label: 'KD' }, { key: 'priority', label: 'Priority' }].map(({ key, label }) => (
                <div key={key}>
                  <label style={S.label}>{label}</label>
                  <input type="number" value={(kw as any)[key]} onChange={e => setKw(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={S.btn} onClick={saveKw} disabled={saving}>{saving ? 'Saving...' : 'Add keyword'}</button>
              <button style={{ ...S.btn, background: '#1C1F2A', color: '#8B91A8' }} onClick={() => setKwOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
