'use client'
import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { marked } from 'marked'
import { supabase } from '@/lib/supabase'
import { Output, SiteConnection } from '@/lib/types'

function stripFrontmatter(md: string): string {
  if (!md) return ''
  return md.replace(/^---[\s\S]*?---\s*/, '')
}

function countWords(md: string): number {
  const stripped = stripFrontmatter(md).trim()
  if (!stripped) return 0
  return stripped.split(/\s+/).length
}

function codebaseGitHubConnection(clientId: string): SiteConnection {
  return {
    id: 'codebase-github',
    client_id: clientId,
    platform: 'github',
    label: 'GitHub codebase',
    config: {},
    status: 'connected',
    last_tested_at: null,
    created_at: new Date().toISOString(),
  }
}

function relativeTime(d: string): string {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function CharBadge({ len, min, max }: { len: number; min: number; max: number }) {
  const good = len >= min && len <= max
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', padding: '1px 7px', borderRadius: 99,
      color: good ? 'var(--green)' : 'var(--amber)',
      background: good ? 'var(--green-bg)' : 'var(--amber-bg)',
    }}>
      {len} chars
    </span>
  )
}

const FEEDBACK_PRESETS = [
  { id: 'images', label: 'Generate & embed images', cmd: 'Generate relevant images with SEO filenames and descriptive alt text, embed them naturally throughout the article.' },
  { id: 'toc', label: 'Add table of contents', cmd: 'Add a table of contents after the intro, matching the style of existing posts on the site.' },
  { id: 'intro', label: 'Strengthen the intro', cmd: "Rewrite the intro, it should hook the reader in the first sentence, include the primary keyword naturally, and set up the article's argument clearly." },
  { id: 'meta', label: 'Fix title & meta description', cmd: 'Rewrite the title tag (under 60 chars, lead with keyword) and meta description (150-160 chars, lead with keyword, clear value prop, location signal).' },
  { id: 'snippet', label: 'Add featured snippet block', cmd: 'Add a concise 2-4 sentence snippet block near the top, designed to be pulled as a Google featured snippet answering the primary keyword directly.' },
  { id: 'links', label: 'Add internal links', cmd: 'Identify the best places for internal links to other pages on the site and add them with natural anchor text, no placeholder links.' },
  { id: 'cta', label: 'Improve the CTA', cmd: 'Strengthen the call to action, it should name the specific service, include a location signal, and feel like the natural next step for the reader.' },
  { id: 'faq', label: 'Add FAQ section', cmd: 'Add an FAQ section at the bottom targeting 4-6 related questions people actually search. Mark it for FAQ schema.' },
  { id: 'expand', label: 'Expand word count', cmd: 'Expand the article with more depth, add supporting sections, examples, or context. Aim for at least 300 more words without padding.' },
  { id: 'headings', label: 'Fix heading structure', cmd: 'Review and improve the H2/H3 structure, each heading should match a real search query, do keyword work, and guide the reader logically through the article.' },
  { id: 'trust', label: 'Strengthen trust signals', cmd: 'Weave in more trust signals, named professionals, credentials, years of experience, patient/customer numbers, or review references where appropriate.' },
  { id: 'tone', label: 'Adjust tone & voice', cmd: 'Rewrite sections that feel generic or AI-sounding. The tone should feel human, authoritative, and match the brand voice exactly, no filler phrases.' },
]

export default function OutputDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [output, setOutput] = useState<(Output & { [key: string]: any }) | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [connections, setConnections] = useState<SiteConnection[]>([])
  const [selectedConnection, setSelectedConnection] = useState<string>('')
  const [modified, setModified] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedImg, setCopiedImg] = useState<number | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [brokenImgs, setBrokenImgs] = useState<Set<number>>(new Set())
  // Content panel
  const [segment, setSegment] = useState<'preview' | 'edit'>('preview')
  const [editContent, setEditContent] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  // Actions
  const [approving, setApproving] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState<{ text: string; url?: string } | null>(null)
  // Feedback to Ada
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackTicks, setFeedbackTicks] = useState<Set<string>>(new Set())
  const [feedbackCustom, setFeedbackCustom] = useState('')
  const [firstAgentId, setFirstAgentId] = useState<string | null>(null)
  // Versions
  const [versions, setVersions] = useState<any[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [loadingVersions, setLoadingVersions] = useState(false)

  useEffect(() => {
    if (!id) return
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
    supabase.from('agents').select('id').eq('agent_type', 'seo').order('created_at').limit(1).maybeSingle().then(({ data }) => setFirstAgentId(data?.id ?? null))
    supabase.from('content_outputs').select('*, client_profiles(*)').eq('id', id).single().then(({ data }) => {
      setOutput(data)
      setEditContent(data?.content || '')
      if (data?.client_id) {
        supabase.from('site_connections').select('*').eq('client_id', data.client_id).then(({ data: conns }) => {
          const savedConnections = conns || []
          const hasGitHubConnection = savedConnections.some(conn => conn.platform === 'github')
          const nextConnections = data.client_profiles?.github_repo && !hasGitHubConnection
            ? [...savedConnections, codebaseGitHubConnection(data.client_id)]
            : savedConnections
          setConnections(nextConnections)
          if (nextConnections.length) setSelectedConnection(nextConnections[0].id)
        })
      }
    })
  }, [id])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  function toggleTick(tid: string) {
    setFeedbackTicks(prev => { const n = new Set(prev); n.has(tid) ? n.delete(tid) : n.add(tid); return n })
  }

  function buildFeedbackPrompt() {
    const client = (output as any)?.client_profiles?.name || ''
    const kw = output?.primary_keyword || output?.title || 'this article'
    const selected = FEEDBACK_PRESETS.filter(p => feedbackTicks.has(p.id)).map(p => p.cmd)
    if (feedbackCustom.trim()) selected.push(feedbackCustom.trim())
    if (!selected.length) return null
    const tasks = selected.map((t, i) => `${i + 1}. ${t}`).join('\n')
    return `Revise the draft output ${output?.id} titled "${output?.title || kw}"${client ? ` for ${client}` : ''}. Apply all of the following:\n\n${tasks}\n\nFirst read the existing draft by its output ID. Update that same draft when done, do not create a separate new draft. Present the complete revised article when done.`
  }

  async function copyContent() {
    if (!output) return
    await navigator.clipboard.writeText(output.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  async function copyImageUrl(url: string, idx: number) {
    await navigator.clipboard.writeText(url)
    setCopiedImg(idx)
    setTimeout(() => setCopiedImg(null), 1500)
  }

  async function saveEdit() {
    if (!output || !editContent.trim()) return
    setSavingEdit(true)
    const currentVersion = output.current_version || 1
    await supabase.from('output_versions').insert({
      output_id: id,
      version_number: currentVersion,
      content: output.content,
      title: output.title,
      meta_description: output.meta_description,
      word_count: output.word_count,
      edited_by: 'human',
    })
    const wordCount = countWords(editContent)
    const now = new Date().toISOString()
    await supabase.from('content_outputs').update({
      content: editContent,
      word_count: wordCount,
      current_version: currentVersion + 1,
      last_edited_at: now,
    }).eq('id', id)
    setOutput(prev => prev ? { ...prev, content: editContent, word_count: wordCount, current_version: currentVersion + 1, last_edited_at: now } : prev)
    setModified(true)
    setSavingEdit(false)
    setSegment('preview')
  }

  async function approve() {
    if (!output) return
    setApproving(true)
    await supabase.from('content_outputs').update({ approved: true }).eq('id', id)
    await supabase.from('content_history').insert({
      client_id: output.client_id,
      user_id: userId,
      title: output.title || output.primary_keyword || 'Untitled',
      url: null,
      primary_keyword: output.primary_keyword,
      summary: output.meta_description || output.title || '',
      published_at: new Date().toISOString(),
    })
    setOutput(prev => prev ? { ...prev, approved: true } : prev)
    setApproving(false)
  }

  async function revertToDraft() {
    if (!output) return
    setReverting(true)
    await supabase.from('content_outputs').update({ approved: false }).eq('id', id)
    // Best effort: remove the content_history row this approve created
    await supabase.from('content_history').delete()
      .eq('client_id', output.client_id)
      .eq('title', output.title || output.primary_keyword || 'Untitled')
    setOutput(prev => prev ? { ...prev, approved: false } : prev)
    setReverting(false)
  }

  async function publish() {
    if (!output || !selectedConnection) return
    setPublishing(true)
    setPublishError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      const res = await fetch('/api/connections/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ output_id: output.id, connection_id: selectedConnection }),
      })
      const data = await res.json().catch(() => ({ success: false, error: 'Unexpected response from the publish service' }))
      if (!res.ok || !data.success) {
        setPublishError(data.error || 'Publishing failed')
        setPublishing(false)
        return
      }
      setOutput(prev => prev ? {
        ...prev,
        published_url: data.published_url,
        platform_output: { ...(prev.platform_output || {}), platform: data.platform, committed_at: new Date().toISOString() },
      } : prev)
      setToast({ text: 'Published. View it live →', url: data.published_url })
    } catch (e: any) {
      setPublishError(e.message || 'Something went wrong while publishing')
    }
    setPublishing(false)
  }

  async function deleteDraft() {
    setDeleting(true)
    try {
      await fetch(`/api/outputs/${id}`, { method: 'DELETE' })
      router.push('/outputs')
    } catch {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  async function loadVersions() {
    setLoadingVersions(true)
    const { data } = await supabase.from('output_versions').select('*').eq('output_id', id).order('version_number', { ascending: false })
    setVersions(data || [])
    setLoadingVersions(false)
  }

  async function restoreVersion(v: any) {
    if (!output || !confirm(`Restore version ${v.version_number}? Current content will be saved as a new version.`)) return
    await supabase.from('output_versions').insert({
      output_id: id, version_number: output.current_version || 1,
      content: output.content, title: output.title, meta_description: output.meta_description,
      word_count: output.word_count, edited_by: 'human',
    })
    const wordCount = countWords(v.content || '')
    await supabase.from('content_outputs').update({ content: v.content, title: v.title, meta_description: v.meta_description, word_count: wordCount, current_version: (output.current_version || 1) + 1 }).eq('id', id)
    setOutput(prev => prev ? { ...prev, content: v.content, title: v.title, meta_description: v.meta_description, word_count: wordCount, current_version: (output.current_version || 1) + 1 } : prev)
    setEditContent(v.content || '')
    setModified(true)
    loadVersions()
  }

  const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6, display: 'block' }
  const panel: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '24px 28px', marginBottom: 16 }
  const btnPrimary: React.CSSProperties = { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '10px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s' }
  const btnSecondary: React.CSSProperties = { background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 22px', fontSize: 14, cursor: 'pointer' }
  const btnText: React.CSSProperties = { background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', padding: '10px 12px' }

  if (!output) return <div style={{ color: 'var(--text-2)', fontSize: 14, padding: 40 }}>Loading...</div>

  const isPublished = !!output.published_url
  const isApproved = !!output.approved
  const step = isPublished ? 3 : isApproved ? 2 : 1
  const clientName = (output.client_profiles as any)?.name || ''
  const bodyContent = stripFrontmatter(output.content)
  const wordCount = output.word_count ?? countWords(output.content)
  const images = (output.images || []) as { url: string; alt_text?: string; filename?: string; storage_path?: string }[]
  const titleLen = (output.title || '').length
  const metaLen = (output.meta_description || '').length
  const sourceBadge = output.source === 'scheduled'
    ? { label: 'Scheduled', color: 'var(--amber)', bg: 'var(--amber-bg)' }
    : { label: 'Chat', color: 'var(--purple)', bg: 'var(--purple-bg)' }
  const statusPill = isPublished
    ? { label: 'Published', color: 'var(--green)', bg: 'var(--green-bg)' }
    : isApproved
      ? { label: 'Approved', color: 'var(--accent)', bg: 'var(--accent-bg)' }
      : { label: 'Draft', color: 'var(--amber)', bg: 'var(--amber-bg)' }
  const pillStyle = (p: { color: string; bg: string }): React.CSSProperties => ({
    fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 99, color: p.color, background: p.bg, whiteSpace: 'nowrap',
  })

  const pipelineSteps = [
    { n: 1, label: 'Draft' },
    { n: 2, label: 'Approved' },
    { n: 3, label: 'Published' },
  ]

  return (
    <div style={{ maxWidth: 880, position: 'relative' }}>

      {/* 1. Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
        <div>
          <Link href="/outputs" style={{ fontSize: 13, color: 'var(--text-2)', textDecoration: 'none', display: 'inline-block', marginBottom: 10 }}>← Back to outputs</Link>
          <h1 style={{ fontSize: 23, fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.3, letterSpacing: '-0.4px' }}>
            {output.title || output.primary_keyword || 'Untitled draft'}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 5 }}>
            {clientName ? `${clientName} · ` : ''}{new Date(output.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 32 }}>
          <span style={pillStyle(statusPill)}>{statusPill.label}</span>
          {modified && <span style={pillStyle({ color: 'var(--purple)', bg: 'var(--purple-bg)' })}>Modified</span>}
        </div>
      </div>

      {/* 2. Pipeline indicator */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24, padding: '0 4px' }}>
        {pipelineSteps.map((s, i) => {
          const done = step >= s.n
          const circleBg = done ? (isPublished && s.n === 3 ? 'var(--green)' : 'var(--accent)') : 'transparent'
          return (
            <React.Fragment key={s.n}>
              {i > 0 && (
                <div style={{ flex: 1, height: 2, margin: '0 10px', borderRadius: 99, background: step > s.n - 1 ? 'var(--accent)' : 'var(--border)', transition: 'background 0.4s ease' }} />
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: circleBg, border: done ? 'none' : '1.5px solid var(--border)',
                  color: done ? '#fff' : 'var(--text-2)', fontSize: 11, fontWeight: 600,
                  transition: 'background 0.4s ease',
                }}>
                  {done && step > s.n ? '✓' : s.n}
                </div>
                <span style={{ fontSize: 13, fontWeight: done ? 600 : 400, color: done ? 'var(--text)' : 'var(--text-2)' }}>{s.label}</span>
                {s.n === 3 && isPublished && output.published_url && (
                  <a href={output.published_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--green)', marginLeft: 4 }}>View live →</a>
                )}
              </div>
            </React.Fragment>
          )
        })}
      </div>

      {/* 3. SEO metadata bar */}
      <div style={{ ...panel, padding: '20px 28px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 32px' }}>
          <div>
            <label style={labelStyle}>Title tag</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{output.title || '—'}</span>
              {titleLen > 0 && <CharBadge len={titleLen} min={50} max={60} />}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Meta description</label>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5, flex: 1 }}>{output.meta_description || '—'}</span>
              {metaLen > 0 && <CharBadge len={metaLen} min={150} max={160} />}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Primary keyword</label>
            <div style={{ fontSize: 13.5, color: 'var(--text)' }}>{output.primary_keyword || '—'}</div>
          </div>
          <div>
            <label style={labelStyle}>Word count</label>
            <div style={{ fontSize: 13.5, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{wordCount.toLocaleString()}</div>
          </div>
          <div>
            <label style={labelStyle}>Agent</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--accent-bg)', color: 'var(--accent)', fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '0.5px' }}>AD</span>
              <span style={{ fontSize: 13.5, color: 'var(--text)' }}>Ada</span>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Source</label>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 99, color: sourceBadge.color, background: sourceBadge.bg }}>{sourceBadge.label}</span>
          </div>
        </div>
      </div>

      {/* 4. Image gallery */}
      {images.length > 0 && (
        <div style={panel}>
          <label style={labelStyle}>Images ({images.length})</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 200px)', gap: 14, marginTop: 6 }}>
            {images.map((img, idx) => (
              <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--surface-2)' }}>
                {brokenImgs.has(idx) ? (
                  <div style={{ width: '100%', height: 120, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--red)' }}>
                    Image missing
                  </div>
                ) : (
                  <img
                    src={img.url}
                    alt={img.alt_text || ''}
                    onClick={() => window.open(img.url, '_blank', 'noopener')}
                    onError={() => setBrokenImgs(prev => new Set(prev).add(idx))}
                    style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block', cursor: 'pointer' }}
                  />
                )}
                <div style={{ padding: '8px 10px', background: 'var(--surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {img.filename || img.url.split('/').pop()}
                    </span>
                    <button
                      onClick={() => copyImageUrl(img.url, idx)}
                      title="Copy URL"
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, width: 22, height: 22, cursor: 'pointer', color: copiedImg === idx ? 'var(--green)' : 'var(--text-2)', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}
                    >
                      {copiedImg === idx ? '✓' : '⧉'}
                    </button>
                  </div>
                  {img.alt_text && (
                    <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {img.alt_text}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feedback to Ada panel */}
      {showFeedback && (
        <div style={{ ...panel, border: '1px solid var(--amber)', background: 'var(--amber-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Send feedback to Ada</h3>
              <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, marginBottom: 0 }}>Tick what needs fixing. Ada will revise and resubmit.</p>
            </div>
            {feedbackTicks.size > 0 && <span style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 600, background: 'var(--surface)', padding: '3px 8px', borderRadius: 99 }}>{feedbackTicks.size} selected</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {FEEDBACK_PRESETS.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 'var(--radius)', cursor: 'pointer', background: feedbackTicks.has(p.id) ? 'var(--surface)' : 'var(--bg)', border: `1px solid ${feedbackTicks.has(p.id) ? 'var(--amber)' : 'var(--border)'}`, transition: 'all 0.15s' }}>
                <input type="checkbox" checked={feedbackTicks.has(p.id)} onChange={() => toggleTick(p.id)}
                  style={{ accentColor: 'var(--amber)', width: 14, height: 14, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: feedbackTicks.has(p.id) ? 'var(--amber)' : 'var(--text-2)', fontWeight: feedbackTicks.has(p.id) ? 500 : 400 }}>{p.label}</span>
              </label>
            ))}
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Add your own instructions (optional)</label>
            <textarea rows={2} value={feedbackCustom} onChange={e => setFeedbackCustom(e.target.value)}
              placeholder="e.g. The second section is too long. Tighten it up and add a local statistic near the top." />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={{ ...btnPrimary, background: 'var(--amber)', opacity: (feedbackTicks.size === 0 && !feedbackCustom.trim()) ? 0.4 : 1, cursor: (feedbackTicks.size === 0 && !feedbackCustom.trim()) ? 'not-allowed' : 'pointer' }}
              disabled={feedbackTicks.size === 0 && !feedbackCustom.trim()}
              onClick={() => { const prompt = buildFeedbackPrompt(); if (prompt && firstAgentId) router.push(`/agents/${firstAgentId}?draft=${encodeURIComponent(prompt)}&send=1`) }}>
              Send feedback to Ada
            </button>
            <button style={btnSecondary} onClick={() => { setShowFeedback(false); setFeedbackTicks(new Set()); setFeedbackCustom('') }}>Cancel</button>
          </div>
        </div>
      )}

      {/* 5. Content panel */}
      <div style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Content</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={copyContent} style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12 }}>{copied ? 'Copied' : 'Copy content'}</button>
            <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: 2, border: '1px solid var(--border)' }}>
              {(['preview', 'edit'] as const).map(seg => {
                const active = segment === seg
                const disabled = seg === 'edit' && isPublished
                return (
                  <button
                    key={seg}
                    disabled={disabled}
                    title={disabled ? "Published content can't be edited here. Ask Theo to update it on the site." : undefined}
                    onClick={() => { if (disabled) return; if (seg === 'edit') setEditContent(output.content); setSegment(seg) }}
                    style={{
                      padding: '4px 14px', fontSize: 12, fontWeight: active ? 600 : 400, borderRadius: 'calc(var(--radius) - 2px)',
                      background: active ? 'var(--surface-3)' : 'transparent',
                      border: active ? '1px solid var(--border-bright)' : '1px solid transparent',
                      color: active ? 'var(--text)' : 'var(--text-2)',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.45 : 1,
                    }}>
                    {seg === 'preview' ? 'Preview' : 'Edit'}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {segment === 'preview' ? (
          <div className="markdown-body" dangerouslySetInnerHTML={{ __html: marked.parse(bodyContent) as string }} />
        ) : (
          <div>
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              style={{ width: '100%', minHeight: 480, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6, color: 'var(--text)', resize: 'vertical', outlineColor: 'var(--accent)' }}
            />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
              <button style={{ ...btnPrimary, opacity: savingEdit ? 0.6 : 1 }} onClick={saveEdit} disabled={savingEdit}>{savingEdit ? 'Saving...' : 'Save changes'}</button>
              <button style={{ ...btnText, color: 'var(--text-2)' }} onClick={() => { setEditContent(output.content); setSegment('preview') }}>Cancel</button>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{countWords(editContent).toLocaleString()} words</span>
            </div>
          </div>
        )}
      </div>

      {/* 7. Versions panel */}
      <div style={{ ...panel, padding: '16px 28px' }}>
        <button
          onClick={() => { setShowVersions(s => !s); if (!showVersions) loadVersions() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 0, color: 'var(--text-2)', fontSize: 13 }}>
          <span style={{ fontSize: 10 }}>{showVersions ? '▼' : '▶'}</span>
          <span style={{ fontWeight: 500 }}>Version history</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-dim)' }}>Current: v{output.current_version || 1}</span>
        </button>
        {showVersions && (
          <div style={{ marginTop: 14 }}>
            {loadingVersions ? (
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Loading...</div>
            ) : versions.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>No previous versions saved yet. Versions are created when you edit and save.</div>
            ) : (
              versions.map(v => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Version {v.version_number}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                      {new Date(v.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {' · '}{v.word_count?.toLocaleString() || '?'} words
                      {' · '}<span style={{ color: v.edited_by === 'ada' ? 'var(--accent)' : 'var(--text-2)' }}>{v.edited_by === 'ada' ? 'Ada' : 'You'}</span>
                    </div>
                  </div>
                  {!isPublished && (
                    <button onClick={() => restoreVersion(v)} style={{ fontSize: 11, padding: '4px 12px', borderRadius: 99, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)', cursor: 'pointer' }}>
                      Restore
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Publish error panel (above action bar) */}
      {publishError && (
        <div style={{ borderLeft: '3px solid var(--red)', background: 'var(--red-bg)', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: 'var(--red)', flex: 1 }}>{publishError}</span>
          <button onClick={publish} disabled={publishing} style={{ ...btnSecondary, padding: '6px 14px', fontSize: 12, color: 'var(--red)', flexShrink: 0 }}>
            Retry publish
          </button>
        </div>
      )}

      {/* 6. Sticky action bar */}
      <div style={{
        position: 'sticky', bottom: 0, zIndex: 10, marginTop: 24, marginLeft: -4, marginRight: -4,
        background: 'var(--surface)', borderTop: '1px solid var(--border)', padding: 16,
        borderRadius: 'var(--radius-md) var(--radius-md) 0 0', boxShadow: '0 -4px 16px rgba(0,0,0,0.05)',
      }}>
        {!isApproved && !isPublished && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={approve}
              disabled={approving}
              style={{ ...btnPrimary, background: 'var(--green)', flexGrow: 1, opacity: approving ? 0.6 : 1 }}>
              {approving ? 'Approving...' : '✓ Approve for publishing'}
            </button>
            <button style={btnSecondary} onClick={() => setShowFeedback(s => !s)}>Send feedback to Ada</button>
            {confirmDelete ? (
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text)' }}>Delete this draft?</span>
                <button onClick={deleteDraft} disabled={deleting} style={{ ...btnText, color: '#fff', background: 'var(--red)', borderRadius: 'var(--radius)', padding: '8px 14px', fontWeight: 600, opacity: deleting ? 0.6 : 1 }}>
                  {deleting ? 'Deleting...' : 'Confirm'}
                </button>
                <button onClick={() => setConfirmDelete(false)} style={{ ...btnText, color: 'var(--text-2)' }}>Cancel</button>
              </span>
            ) : (
              <button onClick={() => setConfirmDelete(true)} style={{ ...btnText, color: 'var(--red)' }}>Delete draft</button>
            )}
          </div>
        )}

        {isApproved && !isPublished && (
          <div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                onClick={publish}
                disabled={publishing || connections.length === 0 || !selectedConnection}
                style={{ ...btnPrimary, flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: (publishing || connections.length === 0) ? 0.6 : 1, cursor: (publishing || connections.length === 0) ? 'not-allowed' : 'pointer' }}>
                {publishing && <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />}
                {publishing ? 'Publishing...' : '↑ Publish now'}
              </button>
              {connections.length > 1 && (
                <select
                  value={selectedConnection}
                  onChange={e => setSelectedConnection(e.target.value)}
                  disabled={publishing}
                  required
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: 13, color: 'var(--text)' }}>
                  {connections.map(c => (
                    <option key={c.id} value={c.id}>{c.platform} · {c.label || 'Unlabelled'}</option>
                  ))}
                </select>
              )}
              <button onClick={revertToDraft} disabled={publishing || reverting} style={{ ...btnText, color: 'var(--text-2)', opacity: publishing ? 0.45 : 1 }}>
                {reverting ? 'Reverting...' : 'Revert to draft'}
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 8 }}>
              {publishing ? (
                'Transferring images and committing content. This can take up to a minute.'
              ) : connections.length === 0 ? (
                <>No publishing target. <Link href={`/clients/${output.client_id}?tab=connections`} style={{ color: 'var(--accent)' }}>Add a site connection or connect GitHub in Codebase →</Link></>
              ) : connections.length === 1 ? (
                <>Publishing to {connections[0].platform} · {connections[0].label || 'Unlabelled'}</>
              ) : null}
            </div>
          </div>
        )}

        {isPublished && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ color: 'var(--green)', fontSize: 16 }}>✓</span>
            <span style={{ fontSize: 13, color: 'var(--text)' }}>
              Published {output.platform_output?.committed_at ? relativeTime(output.platform_output.committed_at) : output.last_edited_at ? relativeTime(output.last_edited_at) : 'recently'}
              {output.platform_output?.platform ? ` to ${output.platform_output.platform}` : ''}
            </span>
            <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{output.published_url}</span>
              <button
                onClick={async () => { await navigator.clipboard.writeText(output.published_url || ''); setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 1500) }}
                title="Copy URL"
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, width: 22, height: 22, cursor: 'pointer', color: copiedUrl ? 'var(--green)' : 'var(--text-2)', fontSize: 11, flexShrink: 0, padding: 0 }}>
                {copiedUrl ? '✓' : '⧉'}
              </button>
            </span>
            <a href={output.published_url || '#'} target="_blank" rel="noopener noreferrer" style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block' }}>View live →</a>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 100, background: 'var(--green-bg)', border: '1px solid var(--green)', borderRadius: 'var(--radius-md)', padding: '12px 18px', fontSize: 13, color: 'var(--green)', fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
          {toast.url ? <a href={toast.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)' }}>{toast.text}</a> : toast.text}
        </div>
      )}
    </div>
  )
}
