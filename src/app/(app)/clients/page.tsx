'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Client } from '@/lib/types'
import Link from 'next/link'

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
    const { error } = await supabase.from('client_profiles').insert({ ...form, competitors: [] })
    setSaving(false)
    if (!error) { setOpen(false); setForm(blank); load() }
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

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>
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
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 32, width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 6, color: 'var(--text)', letterSpacing: '-0.3px' }}>Add client</h2>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 24 }}>The more detail you add here, the better every agent performs for this client.</p>
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
            ].map(({ key, label: lbl, type }) => (
              <div key={key} style={{ marginBottom: 18 }}>
                <label style={label}>{lbl}</label>
                {type === 'textarea'
                  ? <textarea rows={3} value={(form as any)[key]} onChange={e => set(key, e.target.value)} />
                  : <input type="text" value={(form as any)[key]} onChange={e => set(key, e.target.value)} />
                }
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button style={btnPrimary} onClick={save} disabled={saving}
                onMouseEnter={e => !saving && (e.currentTarget.style.background = 'var(--accent-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent)')}
              >{saving ? 'Saving...' : 'Add client'}</button>
              <button style={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
