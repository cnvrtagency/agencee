'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Output } from '@/lib/types'

const S = {
  btn: { background: '#6366F1', color: '#fff', border: 'none', borderRadius: 7, padding: '10px 22px', fontSize: 14, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  btnSecondary: { background: '#1C1F2A', color: '#8B91A8', border: 'none', borderRadius: 7, padding: '10px 22px', fontSize: 14, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  panel: { background: '#141720', border: '1px solid #252836', borderRadius: 10, padding: '24px 28px', marginBottom: 20 } as React.CSSProperties,
  label: { fontSize: 11, color: '#8B91A8', textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: 8 },
}

function slugify(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function OutputDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [output, setOutput] = useState<Output | null>(null)
  const [approving, setApproving] = useState(false)
  const [summary, setSummary] = useState('')
  const [pubUrl, setPubUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [showApprove, setShowApprove] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showPublish, setShowPublish] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishPath, setPublishPath] = useState('')
  const [publishError, setPublishError] = useState('')
  const [publishedUrl, setPublishedUrl] = useState('')

  useEffect(() => {
    if (!id) return
    supabase.from('content_outputs').select('*, client_profiles(*)').eq('id', id).single().then(({ data }) => {
      setOutput(data)
      setNotes(data?.notes || '')
      if (data?.published_url) setPublishedUrl(data.published_url)
      if (data?.primary_keyword) setPublishPath(`content/blog/${slugify(data.primary_keyword)}.md`)
    })
  }, [id])

  async function approve() {
    if (!output || !summary.trim()) return
    setApproving(true)
    await supabase.from('content_outputs').update({ approved: true, published_url: pubUrl || null, notes }).eq('id', id)
    await supabase.from('content_history').insert({
      client_id: output.client_id,
      title: output.title || output.primary_keyword || 'Untitled',
      url: pubUrl || null,
      primary_keyword: output.primary_keyword,
      summary: summary,
      published_at: new Date().toISOString(),
    })
    setApproving(false)
    router.push('/outputs')
  }

  async function publish() {
    if (!output || !publishPath.trim()) return
    setPublishing(true); setPublishError('')
    const slug = publishPath.trim()
    const frontmatter = [
      '---',
      `title: "${(output.title || output.primary_keyword || 'Draft').replace(/"/g, "'")}"`,
      output.meta_description ? `description: "${output.meta_description.replace(/"/g, "'")}"` : '',
      output.primary_keyword ? `keyword: "${output.primary_keyword}"` : '',
      `date: "${new Date().toISOString().split('T')[0]}"`,
      '---',
    ].filter(Boolean).join('\n')
    const fileContent = `${frontmatter}\n\n${output.content}`
    const commitMessage = `Add blog post: ${output.title || output.primary_keyword || slug}`
    try {
      const res = await fetch('/api/github', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: output.client_id, path: slug, content: fileContent, message: commitMessage }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) { setPublishError(data.error || 'Commit failed'); setPublishing(false); return }
      await supabase.from('content_outputs').update({ published_url: data.url }).eq('id', id)
      setPublishedUrl(data.url); setShowPublish(false)
    } catch (e: any) { setPublishError(e.message || 'Something went wrong') }
    setPublishing(false)
  }

  async function copy() {
    if (!output) return
    await navigator.clipboard.writeText(output.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  if (!output) return <div style={{ color: '#8B91A8', fontSize: 14 }}>Loading...</div>

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
          <button style={{ ...S.btnSecondary, padding: '7px 14px', fontSize: 13 }} onClick={() => router.push('/outputs')}>← Back</button>
          <div style={{ flex: 1 }} />
          <button style={{ ...S.btnSecondary, padding: '7px 14px', fontSize: 13 }} onClick={copy}>{copied ? 'Copied!' : 'Copy content'}</button>
          {!output.approved && <button style={S.btn} onClick={() => setShowApprove(s => !s)}>Approve & log</button>}
          {output.approved && <span style={{ fontSize: 13, color: '#34D399', fontWeight: 500 }}>✓ Approved</span>}
          {(output as any).client_profiles?.github_repo && (
            publishedUrl
              ? <a href={publishedUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#34D399', fontWeight: 500, textDecoration: 'none' }}>↗ Published</a>
              : <button style={{ ...S.btnSecondary, padding: '7px 14px', fontSize: 13 }} onClick={() => setShowPublish(s => !s)}>Publish to repo</button>
          )}
        </div>

        <div style={S.panel}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24 }}>
            <div>
              <div style={S.label}>Client</div>
              <div style={{ fontSize: 14, color: '#E2E4EE' }}>{(output.client_profiles as any)?.name || '—'}</div>
            </div>
            <div>
              <div style={S.label}>Primary keyword</div>
              <div style={{ fontSize: 14, color: '#E2E4EE' }}>{output.primary_keyword || '—'}</div>
            </div>
            <div>
              <div style={S.label}>Word count</div>
              <div style={{ fontSize: 14, color: '#E2E4EE', fontFamily: '"JetBrains Mono",monospace' }}>{output.word_count?.toLocaleString() || '—'}</div>
            </div>
          </div>
          {output.meta_description && (
            <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #252836' }}>
              <div style={S.label}>Meta description</div>
              <div style={{ fontSize: 14, color: '#8B91A8', lineHeight: 1.5 }}>{output.meta_description}</div>
            </div>
          )}
        </div>

        {showApprove && (
          <div style={{ ...S.panel, border: '1px solid #6366F130', background: '#6366F108' }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#E2E4EE', marginBottom: 16 }}>Approve and log to history</h3>
            <p style={{ fontSize: 13, color: '#8B91A8', marginBottom: 20 }}>Once approved, the agent will remember this piece and won't repeat the same angle.</p>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Summary of what this covers (required)</label>
              <textarea rows={2} value={summary} onChange={e => setSummary(e.target.value)}
                placeholder="e.g. Covers five signs of hearing loss for adults, targets family members booking for relatives." />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Published URL (optional, add after publishing)</label>
              <input value={pubUrl} onChange={e => setPubUrl(e.target.value)} placeholder="https://..." />
            </div>
            <button style={S.btn} onClick={approve} disabled={approving || !summary.trim()}>
              {approving ? 'Approving...' : 'Confirm approval'}
            </button>
          </div>
        )}

        {showPublish && (
          <div style={{ ...S.panel, border: '1px solid #34D39930', background: '#34D39908' }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#E2E4EE', marginBottom: 8 }}>Publish to repo</h3>
            <p style={{ fontSize: 13, color: '#8B91A8', marginBottom: 20, lineHeight: 1.6 }}>Commits the draft as a markdown file to the client's GitHub repo. The file path is relative to the repo root.</p>
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>File path in repo</label>
              <input value={publishPath} onChange={e => setPublishPath(e.target.value)} placeholder="e.g. next-public/content/blog/my-post.md" style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 13 }} />
            </div>
            {publishError && <div style={{ fontSize: 13, color: '#F87171', marginBottom: 14 }}>{publishError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={S.btn} onClick={publish} disabled={publishing || !publishPath.trim()}>
                {publishing ? 'Committing...' : 'Commit to GitHub'}
              </button>
              <button style={S.btnSecondary} onClick={() => { setShowPublish(false); setPublishError('') }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div style={S.panel}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#E2E4EE', marginBottom: 24 }}>{output.title || 'Draft'}</h1>
        <div style={{ fontSize: 15, color: '#C8CAD6', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
          {output.content}
        </div>
      </div>
    </div>
  )
}
