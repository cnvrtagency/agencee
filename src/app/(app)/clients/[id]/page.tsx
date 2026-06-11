'use client'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Client, Keyword, SiteConnection, CompetitorSite, ClientSchedule } from '@/lib/types'

type SitePage = {
  id: string; url: string; title: string | null; h1: string | null
  meta_description: string | null; word_count: number | null
  content_summary: string | null; crawled_at: string
}

const S = {
  h1: { fontSize: 28, fontWeight: 600, color: 'var(--text)', marginBottom: 4, letterSpacing: '-0.5px' } as React.CSSProperties,
  sub: { fontSize: 13.5, color: 'var(--text-2)', marginBottom: 24 } as React.CSSProperties,
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.3)' } as React.CSSProperties,
  panelHead: { padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1.2px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  field: { padding: '16px 20px', borderBottom: '1px solid var(--border)' } as React.CSSProperties,
  fieldLabel: { fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: 6 },
  fieldVal: { fontSize: 14, color: 'var(--text)', lineHeight: 1.6 },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '12px 18px', borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 18px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top' as const },
  btn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '7px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  btnSm: { background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  btnGreen: { background: 'transparent', color: 'var(--green)', border: '1px solid rgba(45,212,160,0.3)', borderRadius: 'var(--radius)', padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 28, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', maxHeight: '85vh', overflowY: 'auto' as const },
  label: { fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, display: 'block', textTransform: 'uppercase' as const, letterSpacing: '0.8px' },
  inputRow: { display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, marginBottom: 14 } as React.CSSProperties,
  inlineField: { marginBottom: 14 } as React.CSSProperties,
}

const intentColor: Record<string, string> = {
  informational: 'var(--accent)', commercial: 'var(--amber)', transactional: 'var(--green)', navigational: 'var(--text-2)',
}

const blankKw = { keyword: '', cluster: '', intent: 'informational', funnel_stage: 'tofu', monthly_volume: '', difficulty: '', priority: '5' }

const PLATFORM_LABELS: Record<string, { label: string; color: string }> = {
  github: { label: 'GitHub', color: 'var(--text)' },
  wordpress: { label: 'WordPress', color: '#21759b' },
  shopify: { label: 'Shopify', color: '#96bf48' },
  webflow: { label: 'Webflow', color: '#4353ff' },
}

type TabKey = 'profile' | 'keywords' | 'pages' | 'codebase' | 'connections' | 'schedule' | 'competitors' | 'search' | 'reports' | 'knowledge'

type GscConnection = {
  id: string; client_id: string; google_account_email: string; property_url: string
  last_synced_at: string | null; status: string
}

type SearchRow = {
  id: string; query: string; page: string; position: number
  impressions: number; clicks: number; ctr: number
  period_start?: string; period_end?: string
}

type ReportRow = {
  id: string; created_at: string; period_start: string; period_end: string; status: string
  data: any
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const [client, setClient] = useState<Client | null>(null)
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [sitePages, setSitePages] = useState<SitePage[]>([])
  const [connections, setConnections] = useState<SiteConnection[]>([])
  const [competitors, setCompetitors] = useState<CompetitorSite[]>([])
  const [schedule, setSchedule] = useState<ClientSchedule | null>(null)
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const [kwOpen, setKwOpen] = useState(false)
  const [kw, setKw] = useState(blankKw)
  const [saving, setSaving] = useState(false)
  const [crawling, setCrawling] = useState(false)
  const [crawlError, setCrawlError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshed, setRefreshed] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [syncSuccess, setSyncSuccess] = useState('')
  const [activeTab, setActiveTab] = useState<TabKey>('profile')
  const [expandedPage, setExpandedPage] = useState<string | null>(null)
  const [githubForm, setGithubForm] = useState({ github_repo: '', github_branch: '', github_token: '' })
  const [githubTokenDirty, setGithubTokenDirty] = useState(false)
  const [savingGithub, setSavingGithub] = useState(false)
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['brand-voice', 'business-details', 'seo-locations']))
  const [savedField, setSavedField] = useState<string | null>(null)

  // GSC state
  const [gscConn, setGscConn] = useState<GscConnection | null>(null)
  const [gscSyncing, setGscSyncing] = useState(false)
  const [gscMsg, setGscMsg] = useState('')
  const [searchRows, setSearchRows] = useState<SearchRow[]>([])
  const [searchPeriod, setSearchPeriod] = useState<'7' | '28' | '90'>('28')
  const [searchView, setSearchView] = useState<'queries' | 'pages'>('queries')

  // AI overview state
  const [overview, setOverview] = useState<{ text: string; updated_at: string; cached: boolean } | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)

  // Ada agent ID for "Brief Ada" button
  const [adaAgentId, setAdaAgentId] = useState<string | null>(null)

  // Reports state
  const [reports, setReports] = useState<ReportRow[]>([])
  const [reportOpen, setReportOpen] = useState(false)
  const [reportPeriodStart, setReportPeriodStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [reportPeriodEnd, setReportPeriodEnd] = useState(() => new Date().toISOString().split('T')[0])
  const [generatingReport, setGeneratingReport] = useState(false)

  // Connections state
  const [connOpen, setConnOpen] = useState(false)
  const [connForm, setConnForm] = useState({ platform: 'wordpress', label: '', config: {} as Record<string, string> })
  const [savingConn, setSavingConn] = useState(false)
  const [testingConn, setTestingConn] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({})

  // Schedule state (legacy client_schedules)
  const [scheduleForm, setScheduleForm] = useState({ agent_id: '', enabled: false, cadence: 'weekly', content_types: ['blog_post'], target_word_count: 1500, notes: '' })
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [runningSchedule, setRunningSchedule] = useState(false)
  const [scheduleMsg, setScheduleMsg] = useState('')

  // New scheduled_jobs state
  const [scheduledJobs, setScheduledJobs] = useState<any[]>([])
  const [jobRuns, setJobRuns] = useState<any[]>([])
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [jobWizard, setJobWizard] = useState<{ open: boolean; editId: string | null; step: 1 | 2 | 3; type: string; cadence: string; runDay: string; runHour: number; name: string }>({
    open: false, editId: null, step: 1, type: '', cadence: 'weekly', runDay: 'monday', runHour: 8, name: '',
  })
  const [savingJob, setSavingJob] = useState(false)
  const [runningJobId, setRunningJobId] = useState<string | null>(null)

  // Knowledge docs state
  const [knowledgeDocs, setKnowledgeDocs] = useState<{ id: string; title: string; content: string; updated_at: string }[]>([])
  const [editingDoc, setEditingDoc] = useState<string | null>(null)
  const [savingDoc, setSavingDoc] = useState(false)
  const [agentNotes, setAgentNotes] = useState<Record<string, any> | null>(null)
  const [knowledgeSummary, setKnowledgeSummary] = useState<string | null>(null)

  // Competitors state
  const [compOpen, setCompOpen] = useState(false)
  const [compForm, setCompForm] = useState({ url: '', name: '' })
  const [savingComp, setSavingComp] = useState(false)
  const [crawlingComp, setCrawlingComp] = useState<string | null>(null)
  const [compPages, setCompPages] = useState<Record<string, any[]>>({})
  const [expandedComp, setExpandedComp] = useState<string | null>(null)
  const [justAddedCompId, setJustAddedCompId] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    loadClient(); loadKw(); loadPages(); loadConnections(); loadCompetitors(); loadSchedule()
    loadGscConnection(); loadReports(); loadSearchPerformance()
    loadScheduledJobs(); loadJobRuns()
    supabase.from('agents').select('id,name').order('created_at').then(({ data }) => setAgents(data || []))
    // Load Ada agent ID for "Brief Ada" buttons
    supabase.from('agents').select('id').eq('agent_type', 'seo').eq('active', true).limit(1).then(({ data }) => {
      if (data?.[0]) setAdaAgentId(data[0].id)
    })
    // Load AI overview (cached if fresh)
    loadOverview()

    // Load knowledge docs, agent notes, and content summary
    supabase.from('client_knowledge').select('docs, agent_notes, content_summary').eq('client_id', id).maybeSingle().then(({ data: kn }) => {
      if (kn?.docs) setKnowledgeDocs(kn.docs as any[])
      if (kn?.agent_notes) setAgentNotes(kn.agent_notes as Record<string, any>)
      if (kn?.content_summary) setKnowledgeSummary(kn.content_summary)
    })

    // Read tab from URL param — handles OAuth redirects
    const tabParam = searchParams?.get('tab') as TabKey | null
    if (tabParam && ['profile', 'keywords', 'pages', 'codebase', 'connections', 'schedule', 'competitors', 'search', 'reports', 'knowledge'].includes(tabParam)) {
      setActiveTab(tabParam)
    }

    // Show GSC success/error message if redirected from OAuth
    const gscParam = searchParams?.get('gsc')
    if (gscParam === 'connected') {
      setGscMsg('Google Search Console connected successfully.')
      setTimeout(() => setGscMsg(''), 4000)
    } else if (gscParam === 'error') {
      const msg = searchParams?.get('message')
      setGscMsg(msg === 'no_properties' ? 'No GSC properties found for this Google account.' : 'Failed to connect Google Search Console.')
    }
  }, [id])

  useEffect(() => {
    if (activeTab === 'search' && searchRows.length === 0 && gscConn) loadSearchPerformance()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, gscConn])

  async function loadGscConnection() {
    const { data } = await supabase.from('google_connections').select('*').eq('client_id', id).eq('status', 'active').maybeSingle()
    setGscConn(data || null)
  }

  async function loadOverview(force = false) {
    // Check cached first from DB — skip API call if fresh
    if (!force) {
      const { data: cp } = await supabase.from('client_profiles').select('ai_overview,ai_overview_updated_at').eq('id', id).single()
      if (cp?.ai_overview && cp.ai_overview_updated_at) {
        const age = Date.now() - new Date(cp.ai_overview_updated_at).getTime()
        if (age < 24 * 60 * 60 * 1000) {
          setOverview({ text: cp.ai_overview, updated_at: cp.ai_overview_updated_at, cached: true })
          return
        }
      }
    }
    setOverviewLoading(true)
    try {
      const res = await fetch(`/api/clients/${id}/overview`, { method: 'POST' })
      const data = await res.json()
      if (data.overview) setOverview({ text: data.overview, updated_at: data.updated_at, cached: data.cached })
    } catch {}
    setOverviewLoading(false)
  }

  function exportCsv(rows: SearchRow[], periodLabel: string) {
    const headers = ['Query', 'Page', 'Position', 'Impressions', 'Clicks', 'CTR']
    const lines = [headers.join(',')]
    for (const r of rows) {
      lines.push([
        `"${r.query.replace(/"/g, '""')}"`,
        `"${(r.page || '').replace(/"/g, '""')}"`,
        r.position.toFixed(1),
        r.impressions,
        r.clicks,
        (r.ctr * 100).toFixed(2) + '%',
      ].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const clientSlug = client?.name.toLowerCase().replace(/\s+/g, '-') ?? 'client'
    a.href = url; a.download = `gsc-${clientSlug}-${periodLabel}d-${new Date().toISOString().split('T')[0]}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  async function loadSearchPerformance() {
    // Load all periods at once — group client-side to avoid mixing rows across periods
    const { data } = await supabase
      .from('search_performance')
      .select('*')
      .eq('client_id', id)
      .order('impressions', { ascending: false })
      .range(0, 2999)
    setSearchRows(data || [])
  }

  async function loadReports() {
    const { data } = await supabase.from('reports').select('*').eq('client_id', id).order('created_at', { ascending: false })
    setReports(data || [])
  }

  async function syncGsc() {
    if (!gscConn) return
    setGscSyncing(true); setGscMsg('')
    const res = await fetch('/api/gsc/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connection_id: gscConn.id }) })
    const data = await res.json()
    if (data.error) setGscMsg(`Error: ${data.error}`)
    else { setGscMsg(`Synced — 7d: ${data.synced?.['7d'] ?? data.synced}, 28d: ${data.synced?.['28d'] ?? ''}, 90d: ${data.synced?.['90d'] ?? ''} rows`); loadGscConnection(); loadSearchPerformance() }
    setGscSyncing(false); setTimeout(() => setGscMsg(''), 4000)
  }

  async function disconnectGsc() {
    if (!gscConn || !confirm('Disconnect Google Search Console?')) return
    await supabase.from('google_connections').update({ status: 'disconnected' }).eq('id', gscConn.id)
    setGscConn(null)
  }

  async function generateReport() {
    setGeneratingReport(true)
    const res = await fetch('/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: id, period_start: reportPeriodStart, period_end: reportPeriodEnd }) })
    const data = await res.json()
    if (data.id) { setReportOpen(false); loadReports() }
    setGeneratingReport(false)
  }

  async function saveClientField(field: string, value: string) {
    await supabase.from('client_profiles').update({ [field]: value }).eq('id', id)
    setSavedField(field)
    setTimeout(() => setSavedField(null), 2000)
  }

  async function loadClient() {
    const { data } = await supabase.from('client_profiles').select('*').eq('id', id).single()
    if (data) {
      setClient(data)
      // Show a masked placeholder when a token already exists — avoids displaying encrypted ciphertext
      setGithubForm({ github_repo: (data as any).github_repo || '', github_branch: (data as any).github_branch || 'main', github_token: (data as any).github_token ? '••••••••••••••••' : '' })
      setGithubTokenDirty(false)
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
  async function loadConnections() {
    const { data } = await supabase.from('site_connections').select('*').eq('client_id', id).order('created_at')
    setConnections(data || [])
  }
  async function loadCompetitors() {
    const { data } = await supabase.from('competitor_sites').select('*').eq('client_id', id).order('created_at')
    setCompetitors(data || [])
  }
  async function loadScheduledJobs() {
    const res = await fetch(`/api/jobs?client_id=${id}`)
    const data = await res.json()
    setScheduledJobs(data.jobs || [])
  }

  async function loadJobRuns() {
    const { data } = await supabase
      .from('job_runs')
      .select('*, scheduled_jobs(name)')
      .eq('client_id', id)
      .order('started_at', { ascending: false })
      .limit(10)
    setJobRuns(data || [])
  }

  async function loadSchedule() {
    const { data } = await supabase.from('client_schedules').select('*').eq('client_id', id).maybeSingle()
    if (data) {
      setSchedule(data)
      setScheduleForm({ agent_id: data.agent_id, enabled: data.enabled, cadence: data.cadence, content_types: data.content_types || ['blog_post'], target_word_count: data.target_word_count || 1500, notes: data.notes || '' })
    }
  }

  async function saveJob() {
    setSavingJob(true)
    const { type: job_type, cadence, runDay, runHour, name, editId } = jobWizard
    const { data: ws } = await supabase.from('workspaces').select('id').limit(1).single()
    const payload = { client_id: id, workspace_id: ws?.id, name, job_type, cadence, run_day: runDay, run_hour: runHour }
    if (editId) {
      await fetch(`/api/jobs/${editId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    } else {
      await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    }
    setSavingJob(false)
    setJobWizard(w => ({ ...w, open: false, editId: null, step: 1, type: '', name: '' }))
    loadScheduledJobs()
  }

  async function runJobNow(jobId: string) {
    setRunningJobId(jobId)
    await fetch('/api/jobs/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }) })
    setRunningJobId(null)
    loadScheduledJobs(); loadJobRuns()
  }

  async function toggleJob(jobId: string, enabled: boolean) {
    await fetch(`/api/jobs/${jobId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
    loadScheduledJobs()
  }

  async function deleteJob(jobId: string) {
    if (!confirm('Delete this scheduled job?')) return
    await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' })
    loadScheduledJobs()
  }

  async function refreshKnowledge() {
    if (!client?.website) return
    setRefreshing(true)
    try {
      await Promise.all([
        fetch('/api/crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: id, website: client.website }),
        }),
        fetch('/api/gsc/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: id }),
        }),
      ])
      await fetch('/api/keywords/backfill-targeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: id }),
      })
      setRefreshed(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      console.error('Knowledge refresh failed:', e)
    }
    setRefreshing(false)
  }

  async function crawl() {
    if (!client?.website) { setCrawlError('No website URL set.'); return }
    setCrawling(true); setCrawlError('')
    try {
      const res = await fetch('/api/crawl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: id, website: client.website }) })
      const data = await res.json()
      if (data.error) setCrawlError(data.error)
      else { loadClient(); loadPages(); setActiveTab('pages') }
    } catch { setCrawlError('Crawl failed.') }
    setCrawling(false)
  }

  async function saveGithub() {
    setSavingGithub(true)
    setSyncError('')
    const payload: any = { github_repo: githubForm.github_repo, github_branch: githubForm.github_branch || 'main' }
    if (githubTokenDirty && githubForm.github_token.trim()) {
      payload.github_token = githubForm.github_token.trim()
    }
    try {
      const res = await fetch(`/api/clients/${id}/github`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setSyncError(data.error || 'Failed to save GitHub config')
        setSavingGithub(false)
        return
      }
    } catch {
      setSyncError('Failed to save GitHub config')
      setSavingGithub(false)
      return
    }
    setSavingGithub(false)
    setGithubTokenDirty(false)
    loadClient()
  }

  async function saveDoc(docId: string, title: string, content: string) {
    setSavingDoc(true)
    const updated = knowledgeDocs.map(d => d.id === docId ? { ...d, title, content, updated_at: new Date().toISOString() } : d)
    setKnowledgeDocs(updated)
    await supabase.from('client_knowledge').upsert({ client_id: id, docs: updated }, { onConflict: 'client_id' })
    setSavingDoc(false)
    setEditingDoc(null)
  }

  async function addDoc() {
    const newDoc = { id: crypto.randomUUID(), title: 'New document', content: '', updated_at: new Date().toISOString() }
    const updated = [...knowledgeDocs, newDoc]
    setKnowledgeDocs(updated)
    await supabase.from('client_knowledge').upsert({ client_id: id, docs: updated }, { onConflict: 'client_id' })
    setEditingDoc(newDoc.id)
  }

  async function deleteDoc(docId: string) {
    const updated = knowledgeDocs.filter(d => d.id !== docId)
    setKnowledgeDocs(updated)
    await supabase.from('client_knowledge').upsert({ client_id: id, docs: updated }, { onConflict: 'client_id' })
  }

  async function syncRepo() {
    setSyncing(true); setSyncError(''); setSyncSuccess('')
    try {
      const res = await fetch('/api/github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: id }) })
      const data = await res.json()
      if (data.error) setSyncError(data.error)
      else { setSyncSuccess(`Synced ${data.total_files} files`); loadClient() }
    } catch { setSyncError('Sync failed.') }
    setSyncing(false)
  }

  async function saveKw() {
    if (!kw.keyword.trim()) return
    setSaving(true)
    await supabase.from('keyword_banks').insert({ client_id: id, keyword: kw.keyword, cluster: kw.cluster || null, intent: kw.intent, funnel_stage: kw.funnel_stage, monthly_volume: kw.monthly_volume ? parseInt(kw.monthly_volume) : null, difficulty: kw.difficulty ? parseInt(kw.difficulty) : null, priority: parseInt(kw.priority) })
    setSaving(false); setKwOpen(false); setKw(blankKw); loadKw()
  }

  async function saveConnection() {
    setSavingConn(true)
    let config = connForm.config

    if (connForm.platform === 'github' && (!config.repo || config.repo === '')) {
      config = {
        repo: (client as any).github_repo || '',
        branch: (client as any).github_branch || 'main',
      }
    }

    if (connForm.platform === 'github' && !config.repo) {
      setSavingConn(false)
      alert('No GitHub repo configured. Add one in the Codebase tab first.')
      return
    }

    await supabase.from('site_connections').insert({
      client_id: id,
      platform: connForm.platform,
      label: connForm.label || null,
      config,
      status: 'connected',
    })
    setSavingConn(false)
    setConnOpen(false)
    setConnForm({ platform: 'wordpress', label: '', config: {} })
    loadConnections()
  }

  async function testConnection(connId: string) {
    setTestingConn(connId)
    const res = await fetch('/api/connections/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connection_id: connId }) })
    const data = await res.json()
    setTestResult(prev => ({ ...prev, [connId]: data }))
    setTestingConn(null); loadConnections()
  }

  async function deleteConnection(connId: string) {
    await supabase.from('site_connections').delete().eq('id', connId)
    loadConnections()
  }

  async function saveSchedule() {
    setSavingSchedule(true); setScheduleMsg('')
    if (schedule) {
      await supabase.from('client_schedules').update({ ...scheduleForm, updated_at: new Date().toISOString() }).eq('id', schedule.id)
    } else {
      const next = new Date()
      switch (scheduleForm.cadence) {
        case 'daily': next.setDate(next.getDate() + 1); break
        case 'weekly': next.setDate(next.getDate() + 7); break
        case 'biweekly': next.setDate(next.getDate() + 14); break
        case 'monthly': next.setMonth(next.getMonth() + 1); break
      }
      await supabase.from('client_schedules').insert({ client_id: id, ...scheduleForm, next_run_at: next.toISOString() })
    }
    setSavingSchedule(false); setScheduleMsg('Schedule saved.'); loadSchedule()
    setTimeout(() => setScheduleMsg(''), 3000)
  }

  async function runScheduleNow() {
    setRunningSchedule(true); setScheduleMsg('')
    if (!schedule) return
    const res = await fetch('/api/schedule/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule_id: schedule.id }) })
    const data = await res.json()
    setScheduleMsg(data.ok ? `Queued: "${data.keyword}"` : data.message || data.error || 'Error')
    setRunningSchedule(false); loadSchedule()
  }

  async function addCompetitor() {
    const url = compForm.url.trim()
    if (!url) return
    if (!url.startsWith('http')) { alert('URL must start with http or https'); return }
    setSavingComp(true)
    const { data: wsData } = await supabase.from('workspaces').select('id').limit(1).single()
    const workspaceId = wsData?.id || null
    let hostname = ''
    try { hostname = new URL(url).hostname } catch { hostname = url }
    const name = compForm.name || hostname
    const { data: inserted, error } = await supabase.from('competitor_sites').insert({
      workspace_id: workspaceId,
      client_id: id,
      url,
      name,
    }).select().single()
    if (error) { alert(`Failed to add competitor: ${error.message}`); setSavingComp(false); return }
    // Optimistic add
    if (inserted) { setCompetitors(prev => [...prev, inserted]); setJustAddedCompId(inserted.id) }
    setSavingComp(false); setCompOpen(false); setCompForm({ url: '', name: '' })
  }

  async function crawlCompetitor(compId: string, url: string) {
    setCrawlingComp(compId)
    try {
      const res = await fetch('/api/crawl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: id, website: url, competitor_id: compId }) })
      const data = await res.json()
      if (!data.error) { loadCompetitors(); loadCompPages(compId) }
    } catch {}
    setCrawlingComp(null)
  }

  async function loadCompPages(compId: string) {
    const { data } = await supabase.from('competitor_pages').select('*').eq('competitor_id', compId).order('crawled_at', { ascending: false }).limit(20)
    setCompPages(prev => ({ ...prev, [compId]: data || [] }))
  }

  if (!client) return <div style={{ color: 'var(--text-2)', fontSize: 14, padding: 40 }}>Loading...</div>

  const profileFields = [
    { key: 'description', label: 'Description' },
    { key: 'icp', label: 'Ideal customer' },
    { key: 'usp', label: 'USP' },
    { key: 'brand_voice', label: 'Brand voice' },
    { key: 'content_goals', label: 'Content goals' },
  ]

  const fileTree = (client as any).file_tree
  const githubSyncedAt = (client as any).github_synced_at

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'keywords', label: `Keywords (${keywords.length})` },
    { key: 'pages', label: `Pages (${sitePages.length})` },
    { key: 'codebase', label: fileTree ? 'Codebase ✓' : 'Codebase' },
    { key: 'connections', label: `Connections (${connections.length + (gscConn ? 1 : 0)})` },
    { key: 'competitors', label: `Competitors (${competitors.length})` },
    { key: 'schedule', label: schedule?.enabled ? 'Schedule ✓' : 'Schedule' },
    { key: 'search', label: gscConn ? 'Search Performance ✓' : 'Search Performance' },
    { key: 'reports', label: `Reports (${reports.length})` },
    { key: 'knowledge', label: `Knowledge${knowledgeDocs.length > 0 ? ` (${knowledgeDocs.length})` : ''}` },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <h1 style={S.h1}>{client.name}</h1>
          <p style={S.sub}>
            {client.industry}
            {client.website && <> · <a href={client.website} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{client.website}</a></>}
            {(client as any).last_crawled_at && <span> · Crawled {new Date((client as any).last_crawled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
            {githubSyncedAt && <span> · Repo synced {new Date(githubSyncedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {crawlError && <span style={{ fontSize: 12, color: 'var(--red)' }}>{crawlError}</span>}
          {refreshed && !refreshing && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Refreshed at {refreshed}</span>}
          <button
            style={{ ...S.btnSm, color: refreshing ? 'var(--text-2)' : 'var(--accent)', borderColor: refreshing ? 'var(--border)' : 'rgba(79,127,255,0.3)' }}
            onClick={refreshKnowledge}
            disabled={refreshing || !client?.website}
          >
            {refreshing ? 'Refreshing...' : 'Refresh knowledge panel'}
          </button>
          <button style={S.btnSm} onClick={crawl} disabled={crawling}>{crawling ? 'Crawling...' : sitePages.length > 0 ? 'Re-crawl' : 'Crawl site'}</button>
          {(client as any).github_repo && (
            <button style={{ ...S.btnSm, color: syncing ? 'var(--text-2)' : 'var(--green)', borderColor: syncing ? 'var(--border)' : 'rgba(45,212,160,0.3)' }} onClick={syncRepo} disabled={syncing}>
              {syncing ? 'Syncing...' : fileTree ? 'Re-sync repo' : 'Sync repo'}
            </button>
          )}
        </div>
      </div>

      {/* ── AI Intelligence Overview ── */}
      <div style={{ background: 'var(--surface-2)', borderLeft: '3px solid var(--accent)', borderRadius: 'var(--radius)', padding: '16px 20px', marginBottom: 20 }}>
        {overviewLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 180, height: 13, background: 'var(--surface-3)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
            <div style={{ width: 260, height: 13, background: 'var(--surface-3)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite', animationDelay: '0.15s' }} />
          </div>
        ) : overview ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <p style={{ fontSize: 15, color: 'var(--text)', lineHeight: 1.65, margin: 0, flex: 1 }}>{overview.text}</p>
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {(() => {
                  const mins = Math.round((Date.now() - new Date(overview.updated_at).getTime()) / 60000)
                  const hrs = Math.round(mins / 60)
                  const age = mins < 60 ? `${mins}m ago` : hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`
                  return `${age} · `
                })()}
                <button onClick={() => loadOverview(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 12, fontFamily: 'inherit' }}>Refresh</button>
              </div>
            </div>
          </div>
        ) : !gscConn ? (
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0 }}>Connect Google Search Console to enable AI-powered SEO intelligence for this client.</p>
        ) : null}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{ padding: '6px 16px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: 'none', background: activeTab === t.key ? 'var(--accent)' : 'var(--surface-2)', color: activeTab === t.key ? '#fff' : 'var(--text-2)', fontWeight: activeTab === t.key ? 600 : 400, letterSpacing: '0.3px', whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Profile ── */}
      {activeTab === 'profile' && (
        <div>
          <div style={S.panel}>
            <div style={S.panelHead}><span>Client profile</span></div>
            {profileFields.map(({ key, label }) => (
              <div key={key} style={S.field}>
                <div style={{ ...S.fieldLabel, marginBottom: 8 }}>{label}</div>
                <div style={{ position: 'relative' }}>
                  <textarea
                    rows={3}
                    defaultValue={(client as any)[key] || ''}
                    placeholder={`Enter ${label.toLowerCase()}...`}
                    onBlur={e => saveClientField(key, e.target.value)}
                    style={{
                      width: '100%',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      padding: '8px 10px',
                      color: 'var(--text)',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 13,
                      lineHeight: 1.5,
                      resize: 'vertical',
                      boxSizing: 'border-box' as const,
                    }}
                  />
                  {savedField === key && (
                    <span style={{ position: 'absolute', right: 8, bottom: 8, fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>Saved ✓</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── Brand & Voice collapsible ── */}
          {(() => {
            const sectionKey = 'brand-voice'
            const isOpen = openSections.has(sectionKey)
            const toggle = () => setOpenSections(prev => {
              const next = new Set(prev)
              isOpen ? next.delete(sectionKey) : next.add(sectionKey)
              return next
            })
            const fields = [
              { key: 'content_tone', label: 'Content tone', placeholder: 'e.g. Calm, reassuring, plain English. No jargon.' },
              { key: 'avoid_topics', label: 'Avoid topics', placeholder: 'e.g. Do not mention pricing competitors, avoid clinical language' },
            ]
            return (
              <div style={{ ...S.panel, marginTop: 16 }}>
                <div style={{ ...S.panelHead, cursor: 'pointer' }} onClick={toggle}>
                  <span>{isOpen ? '▼' : '▶'} Brand &amp; Voice</span>
                </div>
                {isOpen && (
                  <div>
                    {fields.map(({ key, label, placeholder }) => (
                      <div key={key} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ ...S.fieldLabel, marginBottom: 8 }}>{label}</div>
                        <div style={{ position: 'relative' }}>
                          <textarea
                            rows={3}
                            defaultValue={(client as any)[key] || ''}
                            placeholder={placeholder}
                            onBlur={e => saveClientField(key, e.target.value)}
                            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 10px', color: 'var(--text)', fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box' }}
                          />
                          {savedField === key && (
                            <span style={{ position: 'absolute', right: 8, bottom: 8, fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>Saved ✓</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── Business Details collapsible ── */}
          {(() => {
            const sectionKey = 'business-details'
            const isOpen = openSections.has(sectionKey)
            const toggle = () => setOpenSections(prev => {
              const next = new Set(prev)
              isOpen ? next.delete(sectionKey) : next.add(sectionKey)
              return next
            })
            const fields = [
              { key: 'pricing_info', label: 'Pricing info', placeholder: 'e.g. Ear wax removal: £75 per appointment. Home hearing test: free.' },
              { key: 'team_info', label: 'Team info', placeholder: 'e.g. Lead audiologist: James Hobson, HCPC registered.' },
              { key: 'trust_signals', label: 'Trust signals', placeholder: 'e.g. HCPC registered, ICO compliant, fully insured' },
              { key: 'service_differentiators', label: 'Differentiators', placeholder: 'e.g. Only provider offering microsuction at home in the North East.' },
              { key: 'cta_approach', label: 'CTA approach', placeholder: 'e.g. Always end with a soft CTA. Never pressure.' },
            ]
            return (
              <div style={{ ...S.panel, marginTop: 16 }}>
                <div style={{ ...S.panelHead, cursor: 'pointer' }} onClick={toggle}>
                  <span>{isOpen ? '▼' : '▶'} Business Details</span>
                </div>
                {isOpen && (
                  <div>
                    {fields.map(({ key, label, placeholder }) => (
                      <div key={key} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ ...S.fieldLabel, marginBottom: 8 }}>{label}</div>
                        <div style={{ position: 'relative' }}>
                          <textarea
                            rows={3}
                            defaultValue={(client as any)[key] || ''}
                            placeholder={placeholder}
                            onBlur={e => saveClientField(key, e.target.value)}
                            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 10px', color: 'var(--text)', fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box' }}
                          />
                          {savedField === key && (
                            <span style={{ position: 'absolute', right: 8, bottom: 8, fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>Saved ✓</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── SEO & Locations collapsible ── */}
          {(() => {
            const sectionKey = 'seo-locations'
            const isOpen = openSections.has(sectionKey)
            const toggle = () => setOpenSections(prev => {
              const next = new Set(prev)
              isOpen ? next.delete(sectionKey) : next.add(sectionKey)
              return next
            })
            const textFields = [
              { key: 'location_info', label: 'Location info', placeholder: 'e.g. Based in Newcastle. Covers all of NE England within 60 miles.' },
              { key: 'target_keywords', label: 'Target keywords', placeholder: 'e.g. private audiologist, home hearing test, ear wax removal near me' },
            ]
            return (
              <div style={{ ...S.panel, marginTop: 16 }}>
                <div style={{ ...S.panelHead, cursor: 'pointer' }} onClick={toggle}>
                  <span>{isOpen ? '▼' : '▶'} SEO &amp; Locations</span>
                </div>
                {isOpen && (
                  <div>
                    {textFields.map(({ key, label, placeholder }) => (
                      <div key={key} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ ...S.fieldLabel, marginBottom: 8 }}>{label}</div>
                        <div style={{ position: 'relative' }}>
                          <textarea
                            rows={3}
                            defaultValue={(client as any)[key] || ''}
                            placeholder={placeholder}
                            onBlur={e => saveClientField(key, e.target.value)}
                            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 10px', color: 'var(--text)', fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box' }}
                          />
                          {savedField === key && (
                            <span style={{ position: 'absolute', right: 8, bottom: 8, fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>Saved ✓</span>
                          )}
                        </div>
                      </div>
                    ))}
                    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ ...S.fieldLabel, marginBottom: 8 }}>Schema type</div>
                      <select
                        defaultValue={(client as any).schema_type || 'LocalBusiness'}
                        onChange={e => saveClientField('schema_type', e.target.value)}
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '7px 10px', color: 'var(--text)', fontFamily: 'var(--font-sans)', fontSize: 13 }}
                      >
                        <option value="LocalBusiness">LocalBusiness</option>
                        <option value="MedicalBusiness">MedicalBusiness</option>
                        <option value="ProfessionalService">ProfessionalService</option>
                        <option value="HealthAndBeautyBusiness">HealthAndBeautyBusiness</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          <div style={{ ...S.panel, marginTop: 16 }}>
            <div style={S.panelHead}><span>Content autonomy</span></div>
            <div style={{ padding: '16px 20px' }}>
              {[
                { value: 'manual', label: 'Manual review (recommended)', desc: 'Ada writes and stages. You review and approve.' },
                { value: 'auto_approve', label: 'Auto-approve', desc: 'Auto-approved but you merge manually.' },
                { value: 'full_autopilot', label: 'Full autopilot', desc: 'Writes, approves, and merges automatically. ⚠ Content goes live without review.' },
              ].map(opt => (
                <label key={opt.value} style={{ display: 'flex', gap: 12, padding: '11px 0', cursor: 'pointer', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
                  <input type="radio" name="content_autonomy" value={opt.value}
                    checked={(client as any).content_autonomy === opt.value || (!((client as any).content_autonomy) && opt.value === 'manual')}
                    onChange={async () => {
                      await supabase.from('client_profiles').update({ content_autonomy: opt.value }).eq('id', id)
                      loadClient()
                    }}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: opt.value === 'full_autopilot' ? 'var(--amber)' : 'var(--text)', marginBottom: 2 }}>{opt.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Keywords ── */}
      {activeTab === 'keywords' && (
        <div style={S.panel}>
          <div style={S.panelHead}>
            <span>Keyword bank ({keywords.length})</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {adaAgentId && (
                <a href={`/agents/${adaAgentId}/keywords`} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>View suggestions →</a>
              )}
              <button style={S.btn} onClick={() => setKwOpen(true)}>+ Add keyword</button>
            </div>
          </div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Keyword</th><th style={S.th}>Cluster</th><th style={S.th}>Intent</th><th style={S.th}>Stage</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Vol</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>KD</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Pos</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Pri</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Opp</th>
              </tr>
            </thead>
            <tbody>
              {[...keywords].sort((a, b) => ((b as any).opportunity_score || 0) - ((a as any).opportunity_score || 0)).map(k => {
                const oppScore: number = (k as any).opportunity_score ?? null
                const oppColor = oppScore === null ? 'var(--surface-3)' : oppScore >= 70 ? 'var(--green)' : oppScore >= 40 ? 'var(--amber)' : 'var(--surface-3)'
                return (
                <tr key={k.id}>
                  <td style={{ ...S.td, color: 'var(--text)', fontWeight: 500 }}>{k.keyword}</td>
                  <td style={{ ...S.td, color: 'var(--text-2)' }}>{k.cluster || '—'}</td>
                  <td style={S.td}>{k.intent && <span style={{ fontSize: 11, fontWeight: 600, color: intentColor[k.intent] || 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{k.intent}</span>}</td>
                  <td style={{ ...S.td, color: 'var(--text-2)', textTransform: 'uppercase', fontSize: 11, fontWeight: 600 }}>{k.funnel_stage || '—'}</td>
                  <td style={{ ...S.td, color: 'var(--text-2)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{k.monthly_volume?.toLocaleString() || '—'}</td>
                  <td style={{ ...S.td, color: 'var(--text-2)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{k.difficulty ?? '—'}</td>
                  <td style={{ ...S.td, color: k.current_position ? 'var(--green)' : 'var(--text-2)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{k.current_position != null ? Math.round(k.current_position * 10) / 10 : '—'}</td>
                  <td style={{ ...S.td, color: 'var(--text-2)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{k.priority}</td>
                  <td style={{ ...S.td, textAlign: 'right' }}>
                    {oppScore !== null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                        <div style={{ width: 36, height: 5, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ width: `${oppScore}%`, height: '100%', background: oppColor, borderRadius: 99 }} />
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: oppColor }}>{oppScore}</span>
                      </div>
                    ) : <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>—</span>}
                  </td>
                </tr>
                )
              })}
              {keywords.length === 0 && <tr><td colSpan={9} style={{ ...S.td, color: 'var(--text-2)', textAlign: 'center', padding: '32px' }}>No keywords yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pages ── */}
      {activeTab === 'pages' && (
        <div style={S.panel}>
          <div style={S.panelHead}><span>Site pages ({sitePages.length})</span></div>
          {sitePages.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>No pages crawled yet</div>
              <button style={S.btn} onClick={crawl} disabled={crawling}>{crawling ? 'Crawling...' : 'Crawl site now'}</button>
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>URL</th><th style={S.th}>Title / H1</th><th style={S.th}>Summary</th><th style={S.th}>Meta</th>
                  <th style={{ ...S.th, textAlign: 'right' as const }}>Words</th>
                </tr>
              </thead>
              <tbody>
                {sitePages.map(p => (
                  <tr key={p.id} onClick={() => setExpandedPage(expandedPage === p.id ? null : p.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...S.td, maxWidth: 160 }}>
                      <a href={p.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'var(--accent)', fontSize: 12, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</a>
                    </td>
                    <td style={{ ...S.td, maxWidth: 180 }}>
                      <div style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || '—'}</div>
                      {p.h1 && p.h1 !== p.title && <div style={{ color: 'var(--text-2)', fontSize: 12 }}>H1: {p.h1}</div>}
                    </td>
                    <td style={{ ...S.td, color: 'var(--text-2)', fontSize: 12, maxWidth: 220 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expandedPage === p.id ? 'normal' : 'nowrap' }}>{p.content_summary || '—'}</div>
                    </td>
                    <td style={{ ...S.td, maxWidth: 200, fontSize: 12 }}>
                      {p.meta_description
                        ? <div style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expandedPage === p.id ? 'normal' : 'nowrap' }}>{p.meta_description}</div>
                        : <span style={{ color: 'var(--red)', fontSize: 11, fontWeight: 600 }}>MISSING</span>}
                    </td>
                    <td style={{ ...S.td, color: 'var(--text-2)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.word_count?.toLocaleString() || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Codebase ── */}
      {activeTab === 'codebase' && (
        <div>
          <div style={S.panel}>
            <div style={S.panelHead}><span>GitHub repository</span></div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20, lineHeight: 1.6 }}>Connect a GitHub repo so Ada can read the codebase structure and commit content directly to the repo.</p>
              <div style={S.inlineField}>
                <label style={S.label}>Repository URL</label>
                <input value={githubForm.github_repo} onChange={e => setGithubForm(f => ({ ...f, github_repo: e.target.value }))} placeholder="https://github.com/owner/repo" />
              </div>
              <div style={S.inputRow}>
                <div>
                  <label style={S.label}>Branch</label>
                  <input value={githubForm.github_branch} onChange={e => setGithubForm(f => ({ ...f, github_branch: e.target.value }))} placeholder="main" />
                </div>
              </div>
              <div style={S.inlineField}>
                <label style={S.label}>Personal access token</label>
                <input type="password" value={githubForm.github_token} onChange={e => { setGithubForm(f => ({ ...f, github_token: e.target.value })); setGithubTokenDirty(true) }} placeholder="ghp_..." />
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>Stored securely. Needs repo read/write access.</div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button style={S.btn} onClick={saveGithub} disabled={savingGithub}>{savingGithub ? 'Saving...' : 'Save'}</button>
                {(client as any).github_repo && (
                  <button style={{ ...S.btn, background: 'var(--surface-2)', color: 'var(--green)', border: '1px solid rgba(45,212,160,0.3)' }} onClick={syncRepo} disabled={syncing}>{syncing ? 'Syncing...' : 'Sync file tree'}</button>
                )}
                {syncError && <span style={{ fontSize: 12, color: 'var(--red)' }}>{syncError}</span>}
                {syncSuccess && <span style={{ fontSize: 12, color: 'var(--green)' }}>{syncSuccess}</span>}
              </div>
            </div>
          </div>
          {fileTree ? (
            <div style={S.panel}>
              <div style={S.panelHead}>
                <span>File tree</span>
                <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 400, textTransform: 'none' as const, letterSpacing: 0 }}>Synced {githubSyncedAt ? new Date(githubSyncedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{fileTree}</pre>
              </div>
            </div>
          ) : (client as any).github_repo ? (
            <div style={{ ...S.panel, padding: '32px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>Repo saved. Sync the file tree to give Ada visibility into the codebase structure.</div>
              <button style={S.btn} onClick={syncRepo} disabled={syncing}>{syncing ? 'Syncing...' : 'Sync file tree now'}</button>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Connections ── */}
      {activeTab === 'connections' && (
        <div>
          <div style={S.panel}>
            <div style={S.panelHead}>
              <span>Site connections ({connections.length})</span>
              <button style={S.btn} onClick={() => setConnOpen(true)}>+ Add connection</button>
            </div>
            {connections.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>No connections yet. Add a WordPress, Shopify, Webflow, or GitHub connection to enable direct publishing.</div>
                <button style={S.btn} onClick={() => setConnOpen(true)}>Add your first connection</button>
              </div>
            ) : (
              <div>
                {connections.map((c, i) => {
                  const p = PLATFORM_LABELS[c.platform] || { label: c.platform, color: 'var(--text)' }
                  const result = testResult[c.id]
                  return (
                    <div key={c.id} style={{ padding: '16px 20px', borderBottom: i < connections.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{c.label || p.label}</span>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--surface-3)', color: 'var(--text-2)', fontWeight: 500 }}>{p.label}</span>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: c.status === 'connected' ? 'var(--green-bg)' : 'var(--red-bg)', color: c.status === 'connected' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{c.status}</span>
                        </div>
                        {c.last_tested_at && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Last tested: {new Date(c.last_tested_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
                        {result && <div style={{ fontSize: 12, color: result.ok ? 'var(--green)' : 'var(--red)', marginTop: 4 }}>{result.message}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button style={S.btnSm} onClick={() => testConnection(c.id)} disabled={testingConn === c.id}>{testingConn === c.id ? 'Testing...' : 'Test'}</button>
                        <button style={{ ...S.btnSm, color: 'var(--red)', borderColor: 'rgba(239,68,68,0.3)' }} onClick={() => deleteConnection(c.id)}>Remove</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── GSC Section inside Connections ── */}
      {activeTab === 'connections' && (
        <div style={{ ...S.panel, marginTop: 16 }}>
          <div style={S.panelHead}><span>Google Search Console</span></div>
          <div style={{ padding: 20 }}>
            {!gscConn ? (
              <div>
                <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.6 }}>Connect Google Search Console to import real ranking data for this client's keywords and pages.</p>
                <a href={`/api/auth/google?client_id=${id}`} style={{ ...S.btn, display: 'inline-block', textDecoration: 'none', padding: '8px 16px' }}>Connect Search Console</a>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{gscConn.google_account_email}</span>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--green-bg)', color: 'var(--green)', fontWeight: 600 }}>Connected</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{gscConn.property_url}</div>
                  {gscConn.last_synced_at && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Last synced: {new Date(gscConn.last_synced_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  {gscMsg && <span style={{ fontSize: 12, color: gscMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>{gscMsg}</span>}
                  <button style={S.btnSm} onClick={syncGsc} disabled={gscSyncing}>{gscSyncing ? 'Syncing...' : 'Sync now'}</button>
                  <button style={{ ...S.btnSm, color: 'var(--red)', borderColor: 'rgba(239,68,68,0.3)' }} onClick={disconnectGsc}>Disconnect</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Competitors ── */}
      {activeTab === 'competitors' && (
        <div>
          <div style={S.panel}>
            <div style={S.panelHead}>
              <span>Competitor sites ({competitors.length})</span>
              <button style={S.btn} onClick={() => setCompOpen(true)}>+ Add competitor</button>
            </div>
            {competitors.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>Add competitor URLs to let Ada analyse what they cover and identify content gaps.</div>
                <button style={S.btn} onClick={() => setCompOpen(true)}>Add first competitor</button>
              </div>
            ) : (
              <div>
                {competitors.map((c, i) => {
                  const pages = compPages[c.id] || []
                  const isExpanded = expandedComp === c.id
                  return (
                    <div key={c.id} style={{ borderBottom: i < competitors.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
                        onClick={() => {
                          setExpandedComp(isExpanded ? null : c.id)
                          if (!isExpanded && !compPages[c.id]) loadCompPages(c.id)
                        }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{c.name || c.url}</div>
                          <a href={c.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{c.url}</a>
                          {c.last_crawled_at && <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 10 }}>Crawled {new Date(c.last_crawled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                          {(() => {
                            const pages = compPages[c.id] || []
                            const withSummary = pages.filter((p: any) => p.content_summary)
                            if (withSummary.length > 0) {
                              return <span style={{ fontSize: 11, color: 'var(--accent)', marginLeft: 8, fontWeight: 500 }}>{withSummary.length} pages analysed</span>
                            }
                            return null
                          })()}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {justAddedCompId === c.id && (
                            <button style={{ ...S.btnGreen, fontSize: 12 }} onClick={e => { e.stopPropagation(); setJustAddedCompId(null); crawlCompetitor(c.id, c.url) }} disabled={crawlingComp === c.id}>
                              Crawl now →
                            </button>
                          )}
                          <button style={S.btnSm} onClick={e => { e.stopPropagation(); crawlCompetitor(c.id, c.url) }} disabled={crawlingComp === c.id}>
                            {crawlingComp === c.id ? 'Crawling...' : c.last_crawled_at ? 'Re-crawl' : 'Crawl'}
                          </button>
                          <button style={{ ...S.btnSm, color: 'var(--red)', borderColor: 'rgba(239,68,68,0.3)' }} onClick={e => { e.stopPropagation(); supabase.from('competitor_sites').delete().eq('id', c.id).then(() => loadCompetitors()) }}>Remove</button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border)', padding: '0 0 4px' }}>
                          {pages.length === 0 ? (
                            <div style={{ padding: '20px', fontSize: 13, color: 'var(--text-2)' }}>{c.last_crawled_at ? 'No pages found.' : 'Crawl to see competitor pages.'}</div>
                          ) : (
                            <table style={{ ...S.table }}>
                              <thead>
                                <tr><th style={{ ...S.th, background: 'transparent', paddingLeft: 20 }}>URL</th><th style={S.th}>Title</th><th style={S.th}>Summary</th><th style={{ ...S.th, textAlign: 'right' as const }}>Words</th></tr>
                              </thead>
                              <tbody>
                                {pages.map((p: any) => (
                                  <tr key={p.id}>
                                    <td style={{ ...S.td, maxWidth: 180, paddingLeft: 20 }}><a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</a></td>
                                    <td style={{ ...S.td, fontSize: 12, color: 'var(--text)', maxWidth: 200 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || '—'}</div></td>
                                    <td style={{ ...S.td, fontSize: 12, color: 'var(--text-2)', maxWidth: 240 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.content_summary || '—'}</div></td>
                                    <td style={{ ...S.td, color: 'var(--text-2)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.word_count?.toLocaleString() || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Schedule ── */}
      {activeTab === 'schedule' && (() => {
        const JOB_TYPES = [
          { type: 'gsc_intelligence', icon: '🔍', label: 'GSC Intelligence', desc: 'Syncs search data, scores keywords, updates briefing room' },
          { type: 'keyword_research', icon: '🔑', label: 'Keyword Research', desc: 'Finds new keyword opportunities from GSC and competitors' },
          { type: 'content', icon: '✍️', label: 'Content Creation', desc: 'Writes and stages content based on your content calendar' },
          { type: 'site_audit', icon: '🔧', label: 'Site Audit', desc: 'Crawls your site and surfaces technical issues' },
        ]
        const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
        const HOURS = Array.from({ length: 24 }, (_, i) => i)
        const fmtHour = (h: number) => `${String(h).padStart(2,'0')}:00`
        const fmtRelTime = (s: string | null) => {
          if (!s) return 'Never'
          const mins = Math.round((Date.now() - new Date(s).getTime()) / 60000)
          if (mins < 60) return `${mins}m ago`
          const hrs = Math.round(mins / 60)
          if (hrs < 24) return `${hrs}h ago`
          return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        }
        const statusColor = (s: string | null) => s === 'success' ? 'var(--green)' : s === 'failed' ? 'var(--red)' : s === 'running' ? 'var(--accent)' : 'var(--text-dim)'
        const statusIcon = (s: string | null) => s === 'success' ? '✓' : s === 'failed' ? '✗' : s === 'running' ? '◌' : '—'

        return (
        <div>
          {/* Job list */}
          <div style={S.panel}>
            <div style={S.panelHead}>
              <span>Scheduled jobs ({scheduledJobs.length})</span>
              <button style={S.btn} onClick={() => setJobWizard(w => ({ ...w, open: true, editId: null, step: 1, type: '', name: '' }))}>+ Add job</button>
            </div>
            {scheduledJobs.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>No jobs scheduled yet. Add a job to automate recurring tasks for {client.name}.</div>
                <button style={S.btn} onClick={() => setJobWizard(w => ({ ...w, open: true, editId: null, step: 1, type: '', name: '' }))}>Add first job</button>
              </div>
            ) : scheduledJobs.map((job, i) => {
              const jt = JOB_TYPES.find(x => x.type === job.job_type)
              return (
                <div key={job.id} style={{ padding: '16px 20px', borderBottom: i < scheduledJobs.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>{jt?.icon || '⚙️'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{job.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
                        {job.cadence.charAt(0).toUpperCase() + job.cadence.slice(1)}{job.run_day ? ` · ${job.run_day.charAt(0).toUpperCase() + job.run_day.slice(1)}` : ''} at {fmtHour(job.run_hour || 8)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      Last run: {fmtRelTime(job.last_run_at)}{job.last_run_status ? ` · ` : ''}
                      {job.last_run_status && <span style={{ color: statusColor(job.last_run_status), fontWeight: 600 }}>{job.last_run_status}</span>}
                      {job.last_run_summary && <span> · {job.last_run_summary.slice(0, 60)}{job.last_run_summary.length > 60 ? '…' : ''}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    {/* Toggle */}
                    <div onClick={() => toggleJob(job.id, !job.enabled)}
                      style={{ width: 32, height: 18, borderRadius: 99, background: job.enabled ? 'var(--accent)' : 'var(--surface-3)', position: 'relative', cursor: 'pointer', border: '1px solid var(--border)', transition: 'background 0.2s', flexShrink: 0 }}>
                      <div style={{ position: 'absolute', top: 2, left: job.enabled ? 15 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                    </div>
                    <button style={S.btnSm} onClick={() => {
                      setJobWizard({ open: true, editId: job.id, step: 2, type: job.job_type, cadence: job.cadence, runDay: job.run_day || 'monday', runHour: job.run_hour || 8, name: job.name })
                    }}>Edit</button>
                    <button style={{ ...S.btnSm, color: 'var(--accent)', borderColor: 'rgba(79,127,255,0.3)' }}
                      onClick={() => runJobNow(job.id)}
                      disabled={runningJobId === job.id}>
                      {runningJobId === job.id ? '...' : 'Run now ▶'}
                    </button>
                    <button style={{ ...S.btnSm, color: 'var(--red)', borderColor: 'rgba(242,107,107,0.2)' }} onClick={() => deleteJob(job.id)}>✕</button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Recent runs */}
          {jobRuns.length > 0 && (
            <div style={{ ...S.panel, marginTop: 16 }}>
              <div style={S.panelHead}><span>Recent runs</span></div>
              {jobRuns.map((run, i) => (
                <div key={run.id} style={{ borderBottom: i < jobRuns.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                    style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                    <span style={{ fontSize: 14, color: statusColor(run.status), fontWeight: 600, flexShrink: 0 }}>{statusIcon(run.status)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{(run.scheduled_jobs as any)?.name || 'Unknown job'}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-2)', marginLeft: 8 }}>{new Date(run.started_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{run.summary}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{expandedRunId === run.id ? '▲' : '▼'}</span>
                  </div>
                  {expandedRunId === run.id && run.detail && (
                    <div style={{ padding: '0 20px 12px', background: 'var(--surface-2)' }}>
                      <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {JSON.stringify(run.detail, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Job wizard — inline panel */}
          {jobWizard.open && (
            <div style={{ ...S.panel, marginTop: 16, padding: 24 }}>
              {/* Step indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
                {[1,2,3].map(s => (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, background: jobWizard.step >= s ? 'var(--accent)' : 'var(--surface-3)', color: jobWizard.step >= s ? '#fff' : 'var(--text-dim)' }}>{s}</div>
                    {s < 3 && <div style={{ width: 24, height: 1, background: jobWizard.step > s ? 'var(--accent)' : 'var(--border)' }} />}
                  </div>
                ))}
                <span style={{ fontSize: 12, color: 'var(--text-2)', marginLeft: 4 }}>
                  {jobWizard.step === 1 ? 'Job type' : jobWizard.step === 2 ? 'Schedule' : 'Autonomy'}
                </span>
              </div>

              {/* Step 1 — job type */}
              {jobWizard.step === 1 && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>What should this job do?</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
                    {JOB_TYPES.map(jt => (
                      <div key={jt.type}
                        onClick={() => setJobWizard(w => ({ ...w, type: jt.type, name: w.name || jt.label }))}
                        style={{ padding: '14px 16px', borderRadius: 'var(--radius)', border: `1px solid ${jobWizard.type === jt.type ? 'var(--accent)' : 'var(--border)'}`, cursor: 'pointer', background: jobWizard.type === jt.type ? 'rgba(79,127,255,0.08)' : 'var(--surface-2)', transition: 'all 0.15s' }}>
                        <div style={{ fontSize: 20, marginBottom: 6 }}>{jt.icon}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{jt.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>{jt.desc}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button style={S.btn} disabled={!jobWizard.type} onClick={() => setJobWizard(w => ({ ...w, step: 2 }))}>Next →</button>
                    <button style={{ ...S.btn, background: 'var(--surface-3)', color: 'var(--text-2)', border: '1px solid var(--border)' }} onClick={() => setJobWizard(w => ({ ...w, open: false }))}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Step 2 — schedule */}
              {jobWizard.step === 2 && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>When should it run?</div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={S.label}>Cadence</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['daily','weekly','biweekly','monthly'] as const).map(c => (
                        <button key={c} onClick={() => setJobWizard(w => ({ ...w, cadence: c }))}
                          style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: 'none', background: jobWizard.cadence === c ? 'var(--accent)' : 'var(--surface-2)', color: jobWizard.cadence === c ? '#fff' : 'var(--text-2)', fontWeight: jobWizard.cadence === c ? 600 : 400, textTransform: 'capitalize' }}>
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(jobWizard.cadence === 'weekly' || jobWizard.cadence === 'biweekly') && (
                    <div style={{ marginBottom: 14 }}>
                      <label style={S.label}>Day</label>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {DAYS.map(d => (
                          <button key={d} onClick={() => setJobWizard(w => ({ ...w, runDay: d.toLowerCase() }))}
                            style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: 'none', background: jobWizard.runDay === d.toLowerCase() ? 'var(--accent)' : 'var(--surface-2)', color: jobWizard.runDay === d.toLowerCase() ? '#fff' : 'var(--text-2)', fontWeight: jobWizard.runDay === d.toLowerCase() ? 600 : 400 }}>
                            {d.slice(0,3)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                    <div>
                      <label style={S.label}>Time (UTC)</label>
                      <select value={jobWizard.runHour} onChange={e => setJobWizard(w => ({ ...w, runHour: parseInt(e.target.value) }))}>
                        {HOURS.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={S.label}>Job name</label>
                      <input value={jobWizard.name} onChange={e => setJobWizard(w => ({ ...w, name: e.target.value }))} placeholder="e.g. Weekly GSC sync" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {jobWizard.type === 'content'
                      ? <button style={S.btn} onClick={() => setJobWizard(w => ({ ...w, step: 3 }))}>Next →</button>
                      : <button style={S.btn} disabled={savingJob || !jobWizard.name.trim()} onClick={saveJob}>{savingJob ? 'Saving...' : 'Save job'}</button>
                    }
                    <button style={S.btnSm} onClick={() => setJobWizard(w => ({ ...w, step: 1 }))}>← Back</button>
                    <button style={{ ...S.btn, background: 'var(--surface-3)', color: 'var(--text-2)', border: '1px solid var(--border)' }} onClick={() => setJobWizard(w => ({ ...w, open: false }))}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Step 3 — content autonomy (content jobs only) */}
              {jobWizard.step === 3 && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>Content autonomy</div>
                  <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.6 }}>How much control do you want over published content?</p>
                  {[
                    { value: 'manual', label: 'Manual review (recommended)', desc: 'Ada writes and stages. You review and approve.' },
                    { value: 'auto_approve', label: 'Auto-approve', desc: 'Auto-approved but you merge manually.' },
                    { value: 'full_autopilot', label: 'Full autopilot ⚠', desc: 'Writes, approves, and merges automatically. Content goes live without review.' },
                  ].map(opt => (
                    <label key={opt.value} style={{ display: 'flex', gap: 12, padding: '12px 0', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                      <input type="radio" name="autonomy" value={opt.value}
                        defaultChecked={opt.value === 'manual'}
                        onChange={() => supabase.from('client_profiles').update({ content_autonomy: opt.value }).eq('id', id)}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: opt.value === 'full_autopilot' ? 'var(--amber)' : 'var(--text)', marginBottom: 2 }}>{opt.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                  <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                    <button style={S.btn} disabled={savingJob || !jobWizard.name.trim()} onClick={saveJob}>{savingJob ? 'Saving...' : 'Save job'}</button>
                    <button style={S.btnSm} onClick={() => setJobWizard(w => ({ ...w, step: 2 }))}>← Back</button>
                    <button style={{ ...S.btn, background: 'var(--surface-3)', color: 'var(--text-2)', border: '1px solid var(--border)' }} onClick={() => setJobWizard(w => ({ ...w, open: false }))}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        )
      })()}

      {/* ── Search Performance ── */}
      {activeTab === 'search' && (
        <div>
          {!gscConn ? (
            <div style={{ ...S.panel, padding: '48px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>No Search Console connected</div>
              <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>Connect Google Search Console in the Connections tab to see ranking data.</p>
              <button style={S.btn} onClick={() => setActiveTab('connections')}>Go to Connections</button>
            </div>
          ) : (() => {
                // Group all rows by period_start bucket — earlier date = longer period
                const byStart: Record<string, SearchRow[]> = {}
                for (const r of searchRows) {
                  const k = r.period_start || 'unknown'
                  if (!byStart[k]) byStart[k] = []
                  byStart[k].push(r)
                }
                const sortedStarts = Object.keys(byStart).filter(k => k !== 'unknown').sort()
                const buckets: Record<string, string> = { '90': sortedStarts[0] ?? '', '28': sortedStarts[1] ?? sortedStarts[0] ?? '', '7': sortedStarts[sortedStarts.length - 1] ?? '' }
                const periodRows = byStart[buckets[searchPeriod]] ?? searchRows
                const totalRow = periodRows.find(r => r.query === '__total__')
                const queryRows = periodRows.filter(r => r.query !== '__total__' && r.query !== '__page__' && r.query !== '__device__').sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
                const pageRows = periodRows.filter(r => r.query === '__page__').sort((a, b) => (b.impressions || 0) - (a.impressions || 0))

                // Build position lookup from 90d rows for trend comparison
                const rows90 = byStart[buckets['90']] ?? []
                const pos90Map: Record<string, number> = {}
                for (const r of rows90) {
                  if (r.query !== '__total__' && r.query !== '__page__' && r.query !== '__device__') pos90Map[r.query] = r.position
                }

            return (
            <>
              {/* Summary cards */}
              {searchRows.length > 0 && (() => {
                const totalClicks = totalRow?.clicks ?? queryRows.reduce((a, r) => a + r.clicks, 0)
                const totalImpressions = totalRow?.impressions ?? queryRows.reduce((a, r) => a + r.impressions, 0)
                const avgPos = totalRow?.position ?? (queryRows.length > 0
                  ? queryRows.reduce((a, r) => a + r.position * (r.impressions || 1), 0) / Math.max(queryRows.reduce((a, r) => a + (r.impressions || 1), 0), 1)
                  : 0)
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
                    {[
                      { label: 'Avg position', value: avgPos.toFixed(1), color: avgPos < 10 ? 'var(--green)' : avgPos < 20 ? 'var(--amber)' : 'var(--text)' },
                      { label: 'Total clicks', value: totalClicks.toLocaleString(), color: 'var(--accent)' },
                      { label: 'Total impressions', value: totalImpressions.toLocaleString(), color: 'var(--text)' },
                    ].map(card => (
                      <div key={card.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '18px 20px' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 500, color: card.color, marginBottom: 4 }}>{card.value}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px' }}>{card.label}</div>
                      </div>
                    ))}
                  </div>
                )
              })()}

              <div style={S.panel}>
                <div style={S.panelHead}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>{searchView === 'queries' ? `Top queries (last ${searchPeriod === '7' ? '7 days' : searchPeriod === '28' ? '28 days' : '90 days'})` : `Pages (last 28 days)`}</span>
                    <div style={{ display: 'flex', borderRadius: 99, overflow: 'hidden', border: '1px solid var(--border)' }}>
                      {(['queries', 'pages'] as const).map(v => (
                        <button key={v} onClick={() => setSearchView(v)} style={{ padding: '3px 10px', fontSize: 11, cursor: 'pointer', border: 'none', background: searchView === v ? 'var(--accent)' : 'transparent', color: searchView === v ? '#fff' : 'var(--text-2)', fontWeight: searchView === v ? 600 : 400, textTransform: 'capitalize' }}>
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {searchView === 'queries' && (['7', '28', '90'] as const).map(p => (
                      <button key={p} onClick={() => setSearchPeriod(p)} style={{ ...S.btnSm, background: searchPeriod === p ? 'var(--accent)' : 'var(--surface-2)', color: searchPeriod === p ? '#fff' : 'var(--text-2)', border: 'none', padding: '4px 10px', fontSize: 11 }}>
                        {p}d
                      </button>
                    ))}
                    <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 2px' }} />
                    <button style={{ ...S.btnSm, fontSize: 11 }} onClick={() => exportCsv(searchView === 'queries' ? queryRows : pageRows, searchPeriod)}>Export CSV</button>
                    <button style={{ ...S.btnSm, display: 'flex', alignItems: 'center', gap: 4 }} onClick={async () => { await syncGsc(); loadSearchPerformance() }} disabled={gscSyncing}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: gscSyncing ? 'spin 1s linear infinite' : 'none' }}><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                      {gscSyncing ? 'Syncing…' : 'Re-sync'}
                    </button>
                    {gscMsg && <span style={{ fontSize: 11, color: gscMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>{gscMsg}</span>}
                  </div>
                </div>
                {searchRows.length === 0 ? (
                  <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>No search performance data yet.</div>
                    <button style={S.btn} onClick={syncGsc} disabled={gscSyncing}>{gscSyncing ? 'Syncing...' : 'Sync from Search Console'}</button>
                  </div>
                ) : searchView === 'queries' ? (
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Query</th>
                        <th style={S.th}>Page</th>
                        <th style={{ ...S.th, textAlign: 'right' as const }}>Position</th>
                        <th style={{ ...S.th, textAlign: 'right' as const }}>Trend</th>
                        <th style={{ ...S.th, textAlign: 'right' as const }}>Impressions</th>
                        <th style={{ ...S.th, textAlign: 'right' as const }}>Clicks</th>
                        <th style={{ ...S.th, textAlign: 'right' as const }}>CTR</th>
                        <th style={{ ...S.th, textAlign: 'right' as const }}>Opportunity</th>
                        <th style={S.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {queryRows.map(r => {
                        const isNearMiss = r.position >= 5 && r.position <= 15 && r.impressions > 50
                        // Opportunity score column
                        let oppLabel = '—'
                        let oppColor = 'var(--text-2)'
                        if (r.position >= 5 && r.position <= 7) { oppLabel = '★★★ High'; oppColor = 'var(--green)' }
                        else if (r.position >= 8 && r.position <= 11) { oppLabel = '★★ Medium'; oppColor = 'var(--amber)' }
                        else if (r.position >= 12 && r.position <= 15) { oppLabel = '★ Low'; oppColor = 'var(--text-2)' }
                        // Trend vs 90d
                        const pos90 = pos90Map[r.query]
                        let trendIcon = '→'
                        let trendColor = 'var(--text-dim)'
                        if (pos90 !== undefined) {
                          const diff = pos90 - r.position // positive = improved (lower pos)
                          if (diff > 1) { trendIcon = '↑'; trendColor = 'var(--green)' }
                          else if (diff < -1) { trendIcon = '↓'; trendColor = 'var(--red)' }
                        }
                        return (
                          <tr key={r.id} style={{ background: isNearMiss ? 'rgba(245,158,11,0.05)' : 'transparent' }}>
                            <td style={{ ...S.td, color: 'var(--text)', fontWeight: 500, maxWidth: 220 }}>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.query}</div>
                              {isNearMiss && <span style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 600, marginTop: 2, display: 'block' }}>near-miss</span>}
                            </td>
                            <td style={{ ...S.td, fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', maxWidth: 180 }}>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(r.page || '').replace(/^https?:\/\/[^/]+/, '') || '/'}</div>
                            </td>
                            <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: r.position <= 3 ? 'var(--green)' : r.position <= 10 ? 'var(--accent)' : r.position <= 20 ? 'var(--amber)' : 'var(--text-2)' }}>
                              #{r.position.toFixed(1)}
                            </td>
                            <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, color: trendColor, fontWeight: 600 }}>{trendIcon}</td>
                            <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{r.impressions.toLocaleString()}</td>
                            <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)' }}>{r.clicks.toLocaleString()}</td>
                            <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{(r.ctr * 100).toFixed(1)}%</td>
                            <td style={{ ...S.td, textAlign: 'right', fontSize: 11, color: oppColor, fontWeight: 600, whiteSpace: 'nowrap' as const }}>{oppLabel}</td>
                            <td style={{ ...S.td }}>
                              {isNearMiss && adaAgentId && (
                                <a href={`/agents/${adaAgentId}?brief=${encodeURIComponent(r.query)}&position=${Math.round(r.position * 10) / 10}&impressions=${r.impressions}`}
                                  style={{ ...S.btnSm, fontSize: 10, padding: '4px 8px', textDecoration: 'none', display: 'inline-block', whiteSpace: 'nowrap' as const, color: 'var(--accent)', borderColor: 'rgba(79,127,255,0.3)' }}>
                                  → Brief Ada
                                </a>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  /* Pages view */
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>URL</th>
                        <th style={{ ...S.th, textAlign: 'right' as const }}>Position</th>
                        <th style={{ ...S.th, textAlign: 'right' as const }}>Impressions</th>
                        <th style={{ ...S.th, textAlign: 'right' as const }}>Clicks</th>
                        <th style={{ ...S.th, textAlign: 'right' as const }}>CTR</th>
                        <th style={S.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.length === 0 ? (
                        <tr><td colSpan={6} style={{ ...S.td, color: 'var(--text-2)', textAlign: 'center', padding: '32px' }}>No page data yet. Re-sync from Search Console to populate page-level data.</td></tr>
                      ) : pageRows.map(r => (
                        <tr key={r.id}>
                          <td style={{ ...S.td, maxWidth: 300, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            <a href={r.page} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: 280 }}>
                              {(r.page || '').replace(/^https?:\/\/[^/]+/, '') || '/'}
                            </a>
                          </td>
                          <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: r.position <= 3 ? 'var(--green)' : r.position <= 10 ? 'var(--accent)' : 'var(--text-2)' }}>#{r.position.toFixed(1)}</td>
                          <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{r.impressions.toLocaleString()}</td>
                          <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.clicks.toLocaleString()}</td>
                          <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{(r.ctr * 100).toFixed(1)}%</td>
                          <td style={{ ...S.td }}>
                            {adaAgentId && (
                              <a href={`/agents/${adaAgentId}?brief=${encodeURIComponent(`This page ${r.page} is getting ${r.impressions} impressions but ranking at position ${r.position.toFixed(1)}. Review it and recommend improvements.`)}&send=1`}
                                style={{ ...S.btnSm, fontSize: 10, padding: '4px 8px', textDecoration: 'none', display: 'inline-block', whiteSpace: 'nowrap' as const }}>
                                Brief Ada
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
            )
          })()}
        </div>
      )}

      {/* ── Reports ── */}
      {activeTab === 'reports' && (
        <div>
          <div style={S.panel}>
            <div style={S.panelHead}>
              <span>Reports ({reports.length})</span>
              <button style={S.btn} onClick={() => setReportOpen(true)}>Generate report</button>
            </div>
            {reports.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>No reports yet. Generate a monthly client report.</div>
                <button style={S.btn} onClick={() => setReportOpen(true)}>Generate first report</button>
              </div>
            ) : (
              <div>
                {reports.map((r, i) => (
                  <div key={r.id} style={{ padding: '16px 20px', borderBottom: i < reports.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                        {r.period_start} — {r.period_end}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-2)' }}>Generated {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                    </div>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: r.status === 'ready' ? 'var(--green-bg)' : 'var(--surface-3)', color: r.status === 'ready' ? 'var(--green)' : 'var(--text-2)', fontWeight: 600 }}>{r.status}</span>
                    <a href={`/reports/${r.id}`} style={{ ...S.btnSm, textDecoration: 'none', display: 'inline-block' }}>View →</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Knowledge docs ── */}
      {activeTab === 'knowledge' && (
        <div>
          {/* Content summary */}
          {knowledgeSummary && (
            <div style={{ ...S.panel, marginBottom: 16 }}>
              <div style={S.panelHead}>Content state</div>
              <div style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
                {knowledgeSummary}
              </div>
            </div>
          )}

          {/* Agent notes — written automatically from conversations */}
          {agentNotes && Object.keys(agentNotes).filter(k => k !== 'competitor_analysis').length > 0 && (
            <div style={{ ...S.panel, marginBottom: 16 }}>
              <div style={S.panelHead}>
                <span>Ada's notes</span>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>Written automatically from conversations</span>
              </div>
              {Object.entries(agentNotes).map(([slug, notes]: [string, any]) => {
                if (slug === 'competitor_analysis') return null
                if (!notes || typeof notes !== 'object') return null
                return (
                  <div key={slug} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>{slug}</div>
                    {notes.last_conversation && (
                      <div style={{ marginBottom: 8 }}>
                        {notes.last_conversation.date && (
                          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
                            Last session — {new Date(notes.last_conversation.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          </div>
                        )}
                        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{notes.last_conversation.summary}</div>
                        {notes.last_conversation.recommendations?.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginBottom: 3 }}>Recommendations</div>
                            {notes.last_conversation.recommendations.map((r: string, i: number) => (
                              <div key={i} style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 2 }}>· {r}</div>
                            ))}
                          </div>
                        )}
                        {notes.last_conversation.pending?.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 600, marginBottom: 3 }}>Pending</div>
                            {notes.last_conversation.pending.map((p: string, i: number) => (
                              <div key={i} style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 2 }}>· {p}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {(notes.history?.length || 0) > 1 && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                        {notes.history.length - 1} previous session{notes.history.length > 2 ? 's' : ''} on record
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div style={S.panel}>
            <div style={S.panelHead}>
              <span>Knowledge docs ({knowledgeDocs.length})</span>
              <button style={S.btn} onClick={addDoc}>+ Add doc</button>
            </div>
            {knowledgeDocs.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
                <div style={{ marginBottom: 12 }}>No knowledge docs yet.</div>
                <div style={{ maxWidth: 420, margin: '0 auto', marginBottom: 20 }}>Add anything you want Ada to know permanently — SEO guidelines, brand rules, industry context, competitor notes, what works for this client.</div>
                <button style={S.btn} onClick={addDoc}>Add first doc</button>
              </div>
            ) : (
              <div>
                {knowledgeDocs.map((doc, i) => (
                  <div key={doc.id} style={{ borderBottom: i < knowledgeDocs.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    {editingDoc === doc.id ? (
                      <div style={{ padding: '16px 20px' }}>
                        <input
                          defaultValue={doc.title}
                          id={`doc-title-${doc.id}`}
                          placeholder="Document title"
                          style={{ width: '100%', marginBottom: 10, fontSize: 14, fontWeight: 600 }}
                        />
                        <textarea
                          defaultValue={doc.content}
                          id={`doc-content-${doc.id}`}
                          rows={10}
                          placeholder="Write anything Ada should know about this client — industry context, specific guidelines, what has worked before, competitor notes..."
                          style={{ width: '100%', fontSize: 13, lineHeight: 1.6, resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button style={S.btn} disabled={savingDoc} onClick={() => {
                            const title = (document.getElementById(`doc-title-${doc.id}`) as HTMLInputElement)?.value || doc.title
                            const content = (document.getElementById(`doc-content-${doc.id}`) as HTMLTextAreaElement)?.value || doc.content
                            saveDoc(doc.id, title, content)
                          }}>
                            {savingDoc ? 'Saving...' : 'Save'}
                          </button>
                          <button style={S.btnSm} onClick={() => setEditingDoc(null)}>Cancel</button>
                          <button style={{ ...S.btnSm, color: 'var(--red, #f87171)', borderColor: 'rgba(239,68,68,0.3)', marginLeft: 'auto' }} onClick={() => deleteDoc(doc.id)}>Delete</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}
                        onClick={() => setEditingDoc(doc.id)}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{doc.title}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                            {doc.content ? doc.content.slice(0, 120) + (doc.content.length > 120 ? '...' : '') : 'Empty — click to edit'}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
                          {new Date(doc.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ ...S.panel, padding: '14px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--text)' }}>What to add here:</strong> SEO best practices for this industry, brand voice rules with examples, what content formats have worked, competitor weaknesses, audience pain points, local market context, things Ada should always or never say. The more specific the better — "avoid clinical language" is weaker than "never say audiological assessment, always say hearing test".
            </div>
          </div>
        </div>
      )}

      {/* ── Add keyword modal ── */}
      {kwOpen && (
        <div style={S.overlay} onClick={() => setKwOpen(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20, color: 'var(--text)', letterSpacing: '-0.3px' }}>Add keyword</h2>
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
              <button style={{ ...S.btn, background: 'var(--surface-3)', color: 'var(--text-2)', border: '1px solid var(--border)' }} onClick={() => setKwOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add connection modal ── */}
      {connOpen && (
        <div style={S.overlay} onClick={() => setConnOpen(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20, color: 'var(--text)', letterSpacing: '-0.3px' }}>Add connection</h2>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Platform</label>
              <select value={connForm.platform} onChange={e => setConnForm(f => ({ ...f, platform: e.target.value, config: {} }))}>
                <option value="wordpress">WordPress</option>
                <option value="shopify">Shopify</option>
                <option value="webflow">Webflow</option>
                <option value="github">GitHub</option>
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Label (optional)</label>
              <input value={connForm.label} onChange={e => setConnForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Main blog" />
            </div>

            {connForm.platform === 'wordpress' && [
              { k: 'url', l: 'Site URL', placeholder: 'https://example.com' },
              { k: 'username', l: 'Username', placeholder: 'admin' },
              { k: 'app_password', l: 'Application password', placeholder: 'xxxx xxxx xxxx' },
            ].map(({ k, l, placeholder }) => (
              <div key={k} style={{ marginBottom: 14 }}>
                <label style={S.label}>{l}</label>
                <input type={k.includes('password') ? 'password' : 'text'} value={(connForm.config as any)[k] || ''} onChange={e => setConnForm(f => ({ ...f, config: { ...f.config, [k]: e.target.value } }))} placeholder={placeholder} />
              </div>
            ))}

            {connForm.platform === 'shopify' && [
              { k: 'shop', l: 'Shop domain', placeholder: 'mystore.myshopify.com' },
              { k: 'access_token', l: 'Access token', placeholder: 'shpat_...' },
            ].map(({ k, l, placeholder }) => (
              <div key={k} style={{ marginBottom: 14 }}>
                <label style={S.label}>{l}</label>
                <input type={k.includes('token') ? 'password' : 'text'} value={(connForm.config as any)[k] || ''} onChange={e => setConnForm(f => ({ ...f, config: { ...f.config, [k]: e.target.value } }))} placeholder={placeholder} />
              </div>
            ))}

            {connForm.platform === 'webflow' && [
              { k: 'api_token', l: 'API token', placeholder: 'Bearer token from Webflow' },
              { k: 'collection_id', l: 'Collection ID (optional)', placeholder: 'CMS collection for blog posts' },
            ].map(({ k, l, placeholder }) => (
              <div key={k} style={{ marginBottom: 14 }}>
                <label style={S.label}>{l}</label>
                <input type={k.includes('token') ? 'password' : 'text'} value={(connForm.config as any)[k] || ''} onChange={e => setConnForm(f => ({ ...f, config: { ...f.config, [k]: e.target.value } }))} placeholder={placeholder} />
              </div>
            ))}

            {connForm.platform === 'github' && (
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.6 }}>
                {(client as any).github_repo
                  ? <span style={{ color: 'var(--green)' }}>Repo: {(client as any).github_repo} -- credentials will be loaded from the Codebase tab automatically.</span>
                  : <span style={{ color: 'var(--amber)' }}>No GitHub repo configured yet. Go to the Codebase tab and add your repo first, then add this connection.</span>
                }
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button style={S.btn} onClick={saveConnection} disabled={savingConn}>{savingConn ? 'Saving...' : 'Add connection'}</button>
              <button style={{ ...S.btn, background: 'var(--surface-3)', color: 'var(--text-2)', border: '1px solid var(--border)' }} onClick={() => setConnOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add competitor modal ── */}
      {compOpen && (
        <div style={S.overlay} onClick={() => setCompOpen(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20, color: 'var(--text)', letterSpacing: '-0.3px' }}>Add competitor</h2>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>URL</label>
              <input value={compForm.url} onChange={e => setCompForm(f => ({ ...f, url: e.target.value }))} placeholder="https://competitor.com" />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Name (optional)</label>
              <input value={compForm.name} onChange={e => setCompForm(f => ({ ...f, name: e.target.value }))} placeholder="Competitor Co" />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={S.btn} onClick={addCompetitor} disabled={savingComp || !compForm.url.trim()}>{savingComp ? 'Saving...' : 'Add competitor'}</button>
              <button style={{ ...S.btn, background: 'var(--surface-3)', color: 'var(--text-2)', border: '1px solid var(--border)' }} onClick={() => setCompOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Generate report modal ── */}
      {reportOpen && (
        <div style={S.overlay} onClick={() => setReportOpen(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20, color: 'var(--text)', letterSpacing: '-0.3px' }}>Generate report</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div>
                <label style={S.label}>Period start</label>
                <input type="date" value={reportPeriodStart} onChange={e => setReportPeriodStart(e.target.value)} />
              </div>
              <div>
                <label style={S.label}>Period end</label>
                <input type="date" value={reportPeriodEnd} onChange={e => setReportPeriodEnd(e.target.value)} />
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.5 }}>Generates an executive summary with content published, search performance, and keyword coverage for the selected period.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={S.btn} onClick={generateReport} disabled={generatingReport}>{generatingReport ? 'Generating...' : 'Generate'}</button>
              <button style={{ ...S.btn, background: 'var(--surface-3)', color: 'var(--text-2)', border: '1px solid var(--border)' }} onClick={() => setReportOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
