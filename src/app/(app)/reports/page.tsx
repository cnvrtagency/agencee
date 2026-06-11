'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const S: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '11px 16px', borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 16px', fontSize: 13, verticalAlign: 'top' as const, borderBottom: '1px solid var(--border)' },
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'var(--text-2)',
  ready: 'var(--green)',
  sent: 'var(--accent)',
}

export default function ReportsPage() {
  const [reports, setReports] = useState<any[]>([])
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [showModal, setShowModal] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [form, setForm] = useState({ client_id: '', period_start: '', period_end: '' })

  useEffect(() => {
    load()
    supabase.from('client_profiles').select('id,name').order('name').then(({ data }) => setClients(data || []))
  }, [])

  async function load() {
    const { data } = await supabase
      .from('reports')
      .select('*, client_profiles(name)')
      .order('created_at', { ascending: false })
    setReports(data || [])
  }

  async function generate() {
    if (!form.client_id || !form.period_start || !form.period_end) return
    setGenerating(true)
    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (data.id) {
        setShowModal(false)
        setForm({ client_id: '', period_start: '', period_end: '' })
        load()
      }
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.5px', marginBottom: 4 }}>Reports</h1>
          <p style={{ fontSize: 13, color: 'var(--text-2)' }}>Auto-generated monthly performance reports for your clients.</p>
        </div>
        <button onClick={() => setShowModal(true)} style={{ padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}>
          Generate report
        </button>
      </div>

      <div style={S.panel}>
        {reports.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>📄</div>
            No reports yet. Generate your first monthly report to get started.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Client', 'Period', 'Status', 'Created', 'Actions'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.id}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ ...S.td, fontWeight: 500 }}>{r.client_profiles?.name || '—'}</td>
                  <td style={{ ...S.td, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {r.period_start} → {r.period_end}
                  </td>
                  <td style={S.td}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[r.status] || 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{r.status}</span>
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                    {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    <Link href={`/reports/${r.id}`} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', marginRight: 14 }}>View</Link>
                    {r.pdf_url && (
                      <a href={r.pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--text-2)', textDecoration: 'none' }}>PDF</a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Generate modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 32, width: 400 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Generate report</h2>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Client</label>
              <select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13 }}>
                <option value="">Select a client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Period start</label>
                <input type="date" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Period end</label>
                <input type="date" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} style={{ width: '100%' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={generate} disabled={generating || !form.client_id || !form.period_start || !form.period_end}
                style={{ padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', opacity: generating ? 0.6 : 1 }}>
                {generating ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
