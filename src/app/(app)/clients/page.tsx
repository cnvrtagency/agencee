'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Client } from '@/lib/types'
import Link from 'next/link'

const blank = { name: '', slug: '', industry: '', website: '' }

export default function ClientsPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    load()
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null
      setUserId(uid)
      if (uid) {
        const { data: ws } = await supabase.from('workspaces').select('id').eq('owner_id', uid).maybeSingle()
        if (ws) setWorkspaceId(ws.id)
      }
    })
  }, [])

  async function load() {
    const { data } = await supabase.from('client_profiles').select('*').order('created_at', { ascending: false })
    setClients(data || [])
  }

  function set(k: string, v: string) {
    setForm(f => {
      const updated = { ...f, [k]: v }
      if (k === 'name' && !f.slug) {
        updated.slug = v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      }
      return updated
    })
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    setSaveError('')
    const { data, error } = await supabase
      .from('client_profiles')
      .insert({
        ...form,
        competitors: [],
        workspace_id: workspaceId,
        user_id: userId,
      })
      .select('id')
      .single()
    setSaving(false)
    if (error) {
      setSaveError('Failed to save. Please try again.')
      console.error('Client insert error:', error.message)
      return
    }
    setOpen(false)
    setForm(blank)
    router.push(`/clients/${data.id}`)
  }

  const btnPrimary: React.CSSProperties = {
    background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)',
    padding: '9px 18px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer',
    transition: 'background 0.15s',
  }
  const btnSecondary: React.CSSProperties = {
    background: 'var(--surface-3)', color: 'var(--text-2)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', padding: '9px 18px', fontSize: 13.5, cursor: 'pointer',
  }
  const label: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6,
    display: 'block', textTransform: 'uppercase', letterSpacing: '0.8px',
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 36 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.5px' }}>Clients</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Manage client profiles that agents pull context from.</p>
        </div>
        <button style={btnPrimary} onClick={() => setOpen(true)}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent)')}
        >Add client</button>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
        {clients.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>No clients yet.</div>
            <button style={btnPrimary} onClick={() => setOpen(true)}>Add your first client</button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Client', 'Industry', 'Website', 'Added'].map(h => (
                  <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px', padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: i < clients.length - 1 ? '1px solid var(--border)' : 'none' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '14px 18px', fontSize: 14, fontWeight: 500 }}>
                    <Link href={`/clients/${c.id}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>{c.name}</Link>
                  </td>
                  <td style={{ padding: '14px 18px', fontSize: 13, color: 'var(--text-2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.industry || <span style={{ color: 'var(--text-dim)' }}>—</span>}
                  </td>
                  <td style={{ padding: '14px 18px', fontSize: 13 }}>
                    {c.website
                      ? <a href={c.website} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{c.website.replace(/^https?:\/\//, '')}</a>
                      : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                  </td>
                  <td style={{ padding: '14px 18px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>
                    {new Date(c.created_at).toLocaleDateString('en-GB')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setOpen(false)}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 32, width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.18)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 6, color: 'var(--text)', letterSpacing: '-0.3px' }}>Add client</h2>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 24 }}>
              Add the basics now. You can fill in brand voice, ICP, competitors and everything else on the client page.
            </p>
            {([
              { key: 'name', lbl: 'Client name', required: true },
              { key: 'website', lbl: 'Website', required: false },
              { key: 'industry', lbl: 'Industry', required: false },
              { key: 'slug', lbl: 'Slug', required: false },
            ] as { key: string; lbl: string; required: boolean }[]).map(({ key, lbl, required }) => (
              <div key={key} style={{ marginBottom: 16 }}>
                <label style={label}>
                  {lbl}{required && <span style={{ color: 'var(--red)', marginLeft: 3 }}>*</span>}
                </label>
                <input
                  type="text"
                  value={(form as any)[key]}
                  onChange={e => set(key, e.target.value)}
                  placeholder={key === 'website' ? 'https://example.com' : key === 'slug' ? 'auto-generated from name' : ''}
                />
              </div>
            ))}
            {saveError && (
              <div style={{ fontSize: 13, color: 'var(--red)', background: 'var(--red-bg, rgba(220,38,38,0.08))', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 'var(--radius)', padding: '8px 12px', marginBottom: 12 }}>
                {saveError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button
                style={{ ...btnPrimary, opacity: (!form.name.trim() || saving) ? 0.5 : 1 }}
                onClick={save}
                disabled={!form.name.trim() || saving}
                onMouseEnter={e => form.name.trim() && !saving && (e.currentTarget.style.background = 'var(--accent-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent)')}
              >
                {saving ? 'Creating...' : 'Create client'}
              </button>
              <button style={btnSecondary} onClick={() => { setOpen(false); setSaveError('') }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
