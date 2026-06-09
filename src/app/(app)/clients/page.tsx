'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Client } from '@/lib/types'
import Link from 'next/link'

const S = {
  h1: { fontSize: 26, fontWeight: 600, color: '#E2E4EE', marginBottom: 4 } as React.CSSProperties,
  sub: { fontSize: 14, color: '#8B91A8', marginBottom: 32 } as React.CSSProperties,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 } as React.CSSProperties,
  btn: { background: '#6366F1', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#8B91A8', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '12px 16px', borderBottom: '1px solid #252836' },
  td: { padding: '14px 16px', fontSize: 14, borderBottom: '1px solid #1C1F2A', verticalAlign: 'top' as const },
  panel: { background: '#141720', border: '1px solid #252836', borderRadius: 10, overflow: 'hidden' } as React.CSSProperties,
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { background: '#141720', border: '1px solid #252836', borderRadius: 12, padding: 32, width: '100%', maxWidth: 560, maxHeight: '80vh', overflowY: 'auto' as const },
  label: { fontSize: 12, fontWeight: 500, color: '#8B91A8', marginBottom: 6, display: 'block', textTransform: 'uppercase' as const, letterSpacing: '0.8px' },
  field: { marginBottom: 18 } as React.CSSProperties,
}

const blank = { name: '', slug: '', industry: '', website: '', description: '', icp: '', usp: '', brand_voice: '', content_goals: '' }

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('client_profiles').select('*').order('created_at', { ascending: false })
    setClients(data || [])
  }

  function set(k: string, v: string) {
    setForm(f => ({ ...f, [k]: v }))
    if (k === 'name' && !form.slug) {
      setForm(f => ({ ...f, name: v, slug: v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') }))
    }
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    const { error } = await supabase.from('client_profiles').insert({
      ...form,
      competitors: [],
    })
    setSaving(false)
    if (!error) { setOpen(false); setForm(blank); load() }
  }

  return (
    <div>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>Clients</h1>
          <p style={S.sub}>Manage client profiles that agents pull context from.</p>
        </div>
        <button style={S.btn} onClick={() => setOpen(true)}>Add client</button>
      </div>

      <div style={S.panel}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Client</th>
              <th style={S.th}>Industry</th>
              <th style={S.th}>Website</th>
              <th style={S.th}>Added</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id}>
                <td style={S.td}>
                  <Link href={`/clients/${c.id}`} style={{ color: '#E2E4EE', fontWeight: 500, textDecoration: 'none' }}>
                    {c.name}
                  </Link>
                </td>
                <td style={{ ...S.td, color: '#8B91A8' }}>{c.industry || '—'}</td>
                <td style={{ ...S.td, color: '#8B91A8' }}>
                  {c.website ? <a href={c.website} target="_blank" rel="noreferrer" style={{ color: '#6366F1' }}>{c.website.replace('https://', '')}</a> : '—'}
                </td>
                <td style={{ ...S.td, color: '#8B91A8', fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>
                  {new Date(c.created_at).toLocaleDateString('en-GB')}
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr><td colSpan={4} style={{ ...S.td, color: '#8B91A8', textAlign: 'center', padding: '40px 16px' }}>No clients yet. Add one to get started.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div style={S.overlay} onClick={() => setOpen(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 6, color: '#E2E4EE' }}>Add client</h2>
            <p style={{ fontSize: 14, color: '#8B91A8', marginBottom: 24 }}>The more detail you add here, the better every agent performs for this client.</p>
            {[
              { key: 'name', label: 'Name', type: 'input' },
              { key: 'slug', label: 'Slug', type: 'input' },
              { key: 'industry', label: 'Industry', type: 'input' },
              { key: 'website', label: 'Website', type: 'input' },
              { key: 'description', label: 'Description', type: 'textarea' },
              { key: 'icp', label: 'Ideal customer profile', type: 'textarea' },
              { key: 'usp', label: 'USP', type: 'textarea' },
              { key: 'brand_voice', label: 'Brand voice', type: 'textarea' },
              { key: 'content_goals', label: 'Content goals', type: 'textarea' },
            ].map(({ key, label, type }) => (
              <div key={key} style={S.field}>
                <label style={S.label}>{label}</label>
                {type === 'textarea'
                  ? <textarea rows={3} value={(form as any)[key]} onChange={e => set(key, e.target.value)} />
                  : <input type="text" value={(form as any)[key]} onChange={e => set(key, e.target.value)} />
                }
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button style={S.btn} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Add client'}</button>
              <button style={{ ...S.btn, background: '#1C1F2A', color: '#8B91A8' }} onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
