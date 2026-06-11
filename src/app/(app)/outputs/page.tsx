'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Output, SiteConnection } from '@/lib/types'

type Tab = 'drafts' | 'approved' | 'published'

function DocGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  )
}

export default function OutputsPage() {
  const router = useRouter()
  const [outputs, setOutputs] = useState<(Output & { [key: string]: any })[]>([])
  const [connectionsByClient, setConnectionsByClient] = useState<Record<string, SiteConnection[]>>({})
  const [tab, setTab] = useState<Tab>('drafts')
  const [userId, setUserId] = useState<string | null>(null)
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set())
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({})
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set())

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
    load()
  }, [])

  async function load() {
    const { data } = await supabase
      .from('content_outputs')
      .select('*, client_profiles(name)')
      .order('created_at', { ascending: false })
      .limit(100)
    setOutputs(data || [])
    const clientIds = Array.from(new Set((data || []).map(o => o.client_id).filter(Boolean)))
    if (clientIds.length) {
      const { data: conns } = await supabase.from('site_connections').select('*').in('client_id', clientIds)
      const grouped: Record<string, SiteConnection[]> = {}
      for (const c of conns || []) {
        grouped[c.client_id] = grouped[c.client_id] || []
        grouped[c.client_id].push(c)
      }
      setConnectionsByClient(grouped)
    }
  }

  const drafts = outputs.filter(o => !o.approved)
  const approved = outputs.filter(o => o.approved && !o.published_url)
  const published = outputs.filter(o => !!o.published_url)
  const visible = tab === 'drafts' ? drafts : tab === 'approved' ? approved : published

  async function approveOutput(o: Output & { [key: string]: any }) {
    await supabase.from('content_outputs').update({ approved: true }).eq('id', o.id)
    await supabase.from('content_history').insert({
      client_id: o.client_id,
      user_id: userId,
      title: o.title || o.primary_keyword || 'Untitled',
      url: null,
      primary_keyword: o.primary_keyword,
      summary: o.meta_description || o.title || '',
      published_at: new Date().toISOString(),
    })
    setFadingIds(prev => new Set(prev).add(o.id))
    setTimeout(() => {
      setOutputs(prev => prev.map(x => x.id === o.id ? { ...x, approved: true } : x))
      setFadingIds(prev => { const n = new Set(prev); n.delete(o.id); return n })
    }, 350)
  }

  async function publishOutput(o: Output & { [key: string]: any }) {
    const conns = connectionsByClient[o.client_id] || []
    if (conns.length !== 1) return
    setPublishingId(o.id)
    setPublishErrors(prev => { const n = { ...prev }; delete n[o.id]; return n })
    try {
      const res = await fetch('/api/connections/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_id: o.id, connection_id: conns[0].id }),
      })
      const data = await res.json().catch(() => ({ success: false, error: 'Unexpected response from the publish service' }))
      if (!res.ok || !data.success) {
        setPublishErrors(prev => ({ ...prev, [o.id]: data.error || 'Publishing failed' }))
      } else {
        setOutputs(prev => prev.map(x => x.id === o.id ? { ...x, published_url: data.published_url, platform_output: { platform: data.platform } } : x))
      }
    } catch (e: any) {
      setPublishErrors(prev => ({ ...prev, [o.id]: e.message || 'Something went wrong' }))
    }
    setPublishingId(null)
  }

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'drafts', label: 'Drafts', count: drafts.length },
    { key: 'approved', label: 'Approved', count: approved.length },
    { key: 'published', label: 'Published', count: published.length },
  ]

  const emptyCopy: Record<Tab, string> = {
    drafts: 'No drafts waiting. Ask Ada to write something.',
    approved: 'Nothing approved yet. Review your drafts first.',
    published: 'Nothing published yet. Approve a draft, then publish it.',
  }

  const pill = (label: string, color: string, bg: string) => (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 'var(--radius)', color, background: bg, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
  )

  const actionBtn: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
    border: 'none', background: 'var(--surface-2)', color: 'var(--text-2)', whiteSpace: 'nowrap',
  }

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.5px' }}>Outputs</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Drafts your agents have produced. Review, approve and publish.</p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '6px 16px', borderRadius: 'var(--radius-md)', fontSize: 12, cursor: 'pointer', border: 'none',
            background: tab === t.key ? 'var(--brand)' : 'var(--surface-2)',
            color: tab === t.key ? '#fff' : 'var(--text-2)',
            fontWeight: tab === t.key ? 600 : 400, letterSpacing: '0.3px',
          }}>{t.label} ({t.count})</button>
        ))}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {visible.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', fontSize: 14, color: 'var(--text-2)' }}>
            {emptyCopy[tab]}
          </div>
        ) : (
          visible.map((o, i) => {
            const thumb = o.images?.[0]?.url
            const conns = connectionsByClient[o.client_id] || []
            const fading = fadingIds.has(o.id)
            const imgCount = o.images?.length || 0
            return (
              <div key={o.id}>
                <div
                  onClick={() => router.push(`/outputs/${o.id}`)}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', cursor: 'pointer',
                    borderBottom: i < visible.length - 1 ? '1px solid var(--border)' : 'none',
                    opacity: fading ? 0 : 1, transition: 'opacity 0.35s ease, background 0.15s',
                  }}>
                  {/* Thumb */}
                  {thumb && !brokenThumbs.has(o.id) ? (
                    <img src={thumb} alt="" onError={() => setBrokenThumbs(prev => new Set(prev).add(o.id))}
                      style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 48, height: 48, borderRadius: 8, background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <DocGlyph />
                    </div>
                  )}
                  {/* Title + client */}
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.title || o.primary_keyword || 'Untitled'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{(o.client_profiles as any)?.name || '—'}</div>
                  </div>
                  {/* Keyword */}
                  <div style={{ flex: '0 1 180px', fontSize: 13, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.primary_keyword || ''}
                  </div>
                  {/* Agent */}
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {o.agent_type === 'seo' ? 'Ada' : o.agent_type === 'technical' ? 'Theo' : o.agent_type || '—'}
                  </div>
                  {/* Counts */}
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                    {(o.word_count || 0).toLocaleString()} words{imgCount > 0 ? ` · ${imgCount} image${imgCount === 1 ? '' : 's'}` : ''}
                  </div>
                  {/* Date */}
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{fmt(o.created_at)}</div>
                  {/* Status pill */}
                  {o.published_url
                    ? pill('Published', 'var(--green)', 'var(--green-bg)')
                    : o.approved
                      ? pill('Approved', 'var(--accent)', 'var(--accent-bg)')
                      : pill('Draft', 'var(--amber)', 'var(--amber-bg)')}
                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                    {!o.approved && (
                      <>
                        <button onClick={() => approveOutput(o)} title="Approve"
                          style={{ ...actionBtn, color: 'var(--brand-accent)', background: 'var(--brand)', border: 'none' }}>
                          Approve
                        </button>
                        <Link href={`/outputs/${o.id}`} style={{ ...actionBtn, textDecoration: 'none', display: 'inline-block' }}>Review</Link>
                      </>
                    )}
                    {o.approved && !o.published_url && (
                      conns.length === 1 ? (
                        <button onClick={() => publishOutput(o)} disabled={publishingId === o.id}
                          style={{ ...actionBtn, color: '#fff', background: 'var(--green)', border: 'none', opacity: publishingId === o.id ? 0.6 : 1 }}>
                          {publishingId === o.id ? 'Publishing...' : 'Publish ↑'}
                        </button>
                      ) : (
                        <Link href={`/outputs/${o.id}`} style={{ ...actionBtn, textDecoration: 'none', display: 'inline-block' }}>Review →</Link>
                      )
                    )}
                    {o.published_url && (
                      <a href={o.published_url} target="_blank" rel="noopener noreferrer"
                        style={{ ...actionBtn, color: 'var(--green)', background: 'var(--green-bg)', border: '1px solid var(--green)', textDecoration: 'none', display: 'inline-block' }}>
                        View live →
                      </a>
                    )}
                  </div>
                </div>
                {publishErrors[o.id] && (
                  <div style={{ padding: '8px 18px', borderBottom: i < visible.length - 1 ? '1px solid var(--border)' : 'none', borderLeft: '3px solid var(--red)', background: 'var(--red-bg)', fontSize: 12, color: 'var(--red)' }}>
                    {publishErrors[o.id]}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
