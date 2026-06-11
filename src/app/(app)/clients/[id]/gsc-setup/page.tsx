'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function GscSetupPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [properties, setProperties] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Tokens passed in URL from OAuth callback (multi-property flow)
  const propertiesParam = searchParams.get('properties')
  const accessTokenParam = searchParams.get('access_token')
  const refreshTokenParam = searchParams.get('refresh_token')
  const expiresInParam = searchParams.get('expires_in')
  const emailParam = searchParams.get('email')
  const fromCallback = !!propertiesParam && !!accessTokenParam

  useEffect(() => {
    async function load() {
      if (fromCallback) {
        // Tokens came from OAuth callback — decode the properties list
        try {
          const decoded = JSON.parse(atob(propertiesParam!))
          setProperties(decoded)
          if (decoded.length === 1) setSelected(decoded[0])
        } catch {
          setError('Could not parse property list from OAuth callback.')
        }
        setLoading(false)
        return
      }

      // Fallback: load existing connection from DB
      const { data: conn } = await supabase
        .from('google_connections')
        .select('*')
        .eq('client_id', id)
        .maybeSingle()
      if (!conn) { setError('No Google Search Console connection found. Connect GSC first.'); setLoading(false); return }
      if (conn.property_url) setSelected(conn.property_url)

      const res = await fetch(`/api/gsc/properties?connection_id=${conn.id}`)
      const data = await res.json()
      if (data.error) { setError(data.error); setLoading(false); return }
      setProperties(data.properties || [])
      setLoading(false)
    }
    load()
  }, [id, fromCallback]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!selected) return
    setSaving(true)

    if (fromCallback) {
      // Save the full connection to DB for the first time
      const { data: { user } } = await supabase.auth.getUser()
      const { data: clientProfile } = await supabase
        .from('client_profiles')
        .select('workspace_id')
        .eq('id', id)
        .single()

      const expiresAt = new Date(Date.now() + (parseInt(expiresInParam || '3600')) * 1000).toISOString()

      const res = await fetch('/api/auth/google/select-property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: id,
          workspace_id: clientProfile?.workspace_id || null,
          site_url: selected,
          access_token: atob(accessTokenParam!),
          refresh_token: refreshTokenParam ? atob(refreshTokenParam) : null,
          expires_at: expiresAt,
          email: emailParam || null,
        }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); setSaving(false); return }
    } else {
      // Update existing connection's property
      const { data: conn } = await supabase
        .from('google_connections')
        .select('id')
        .eq('client_id', id)
        .maybeSingle()
      if (!conn) { setError('Connection not found'); setSaving(false); return }

      const res = await fetch('/api/auth/google/select-property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: conn.id, site_url: selected }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); setSaving(false); return }
    }

    router.push(`/clients/${id}?tab=connections&gsc=connected`)
  }

  if (loading) return <div style={{ padding: 40, color: 'var(--text-2)' }}>Loading properties…</div>

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 400, color: 'var(--text)', marginBottom: 6 }}>Select GSC Property</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Choose which Search Console property to sync data from.</p>
      </div>
      {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius)', padding: '12px 16px', color: 'var(--red)', marginBottom: 20, fontSize: 13 }}>{error}</div>}
      {properties.length === 0 && !error && (
        <div style={{ color: 'var(--text-2)', fontSize: 13 }}>No properties found in this Google account.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        {properties.map(p => (
          <div key={p} onClick={() => setSelected(p)} style={{ padding: '12px 16px', borderRadius: 'var(--radius)', border: `1px solid ${selected === p ? 'var(--accent)' : 'var(--border)'}`, background: selected === p ? 'rgba(79,127,255,0.08)' : 'var(--surface)', cursor: 'pointer', fontSize: 13.5, color: 'var(--text)', transition: 'all 0.15s' }}>
            {p}
          </div>
        ))}
      </div>
      <button
        onClick={save}
        disabled={!selected || saving}
        style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '10px 24px', fontSize: 13.5, fontWeight: 500, cursor: selected ? 'pointer' : 'not-allowed', opacity: selected ? 1 : 0.5 }}
      >
        {saving ? 'Saving…' : 'Use this property'}
      </button>
    </div>
  )
}
