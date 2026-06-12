'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const S: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.3)' },
  panelHead: { padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1.2px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: { textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '12px 18px', borderBottom: '1px solid var(--border)' },
  td: { padding: '11px 18px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top' as const },
  statCard: { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '18px 20px' },
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const [report, setReport] = useState<any>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!id) return
    supabase.from('reports').select('*').eq('id', id).single().then(({ data }) => setReport(data))
  }, [id])

  async function exportPdf() {
    setExporting(true)
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ])
      const el = document.getElementById('report-content')
      if (!el) return
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pdfWidth = pdf.internal.pageSize.getWidth()
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
      pdf.save(`report-${id}.pdf`)
    } catch (e: any) {
      console.error('PDF export failed:', e)
    }
    setExporting(false)
  }

  if (!report) return <div style={{ color: 'var(--text-2)', fontSize: 14, padding: 40 }}>Loading...</div>

  const d = report.data || {}
  const client = d.client || {}
  const sp = d.search_performance || {}
  const kw = d.keywords || {}
  const outputs: any[] = d.outputs || []
  const topQueries: any[] = sp.top_queries || []
  const nearMiss: any[] = sp.near_miss || []

  const fmt = (s: string) => s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

  return (
    <div style={{ maxWidth: 900 }} id="report-content">
      {/* Header */}
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 8 }}>Prepared by Agencee</div>
          <h1 style={{ fontSize: 30, fontWeight: 600, color: 'var(--text)', marginBottom: 4, letterSpacing: '-0.5px' }}>{client.name} — Monthly Report</h1>
          <p style={{ fontSize: 14, color: 'var(--text-2)' }}>
            {fmt(report.period_start)} – {fmt(report.period_end)}
            <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-dim)' }}>Generated {fmt(report.created_at)}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={exportPdf}
            disabled={exporting}
            style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '7px 14px', fontSize: 13, cursor: exporting ? 'wait' : 'pointer', fontWeight: 500, opacity: exporting ? 0.6 : 1 }}
          >
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
          <Link href={`/clients/${client.id}?tab=reports`} style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500, textDecoration: 'none', display: 'inline-block' }}>
            ← Back
          </Link>
        </div>
      </div>

      {/* Executive Summary */}
      {d.executive_summary && (
        <div style={{ ...S.panel }}>
          <div style={S.panelHead}><span>Executive Summary</span></div>
          <div style={{ padding: '20px 24px' }}>
            <p style={{ fontSize: 14.5, color: 'var(--text)', lineHeight: 1.7, margin: 0 }}>{d.executive_summary}</p>
          </div>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Content published', value: outputs.length, color: 'var(--accent)' },
          { label: 'Avg. position', value: sp.avg_position ? sp.avg_position.toFixed(1) : '—', color: sp.avg_position && sp.avg_position < 10 ? 'var(--green)' : 'var(--text)' },
          { label: 'Total clicks', value: (sp.total_clicks || 0).toLocaleString(), color: 'var(--text)' },
          { label: 'Total impressions', value: (sp.total_impressions || 0).toLocaleString(), color: 'var(--text)' },
        ].map(card => (
          <div key={card.label} style={S.statCard}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 500, color: card.color, marginBottom: 4, letterSpacing: '-1px' }}>{card.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Content published */}
      {outputs.length > 0 && (
        <div style={S.panel}>
          <div style={S.panelHead}><span>Content published ({outputs.length})</span></div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Title</th>
                <th style={S.th}>Keyword</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Words</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {outputs.map((o: any) => (
                <tr key={o.id}>
                  <td style={{ ...S.td, color: 'var(--text)', fontWeight: 500 }}>{o.title || o.primary_keyword}</td>
                  <td style={{ ...S.td, color: 'var(--text-2)' }}>{o.primary_keyword || '—'}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{o.word_count?.toLocaleString() || '—'}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontSize: 12, color: 'var(--text-2)' }}>{fmt(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Search Performance */}
      {topQueries.length > 0 && (
        <div style={S.panel}>
          <div style={S.panelHead}><span>Search performance</span></div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Query</th>
                <th style={S.th}>Page</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Avg position</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Clicks</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Impressions</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>CTR</th>
              </tr>
            </thead>
            <tbody>
              {topQueries.map((r: any, i: number) => (
                <tr key={i}>
                  <td style={{ ...S.td, color: 'var(--text)', fontWeight: 500, maxWidth: 220 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.query}</div>
                  </td>
                  <td style={{ ...S.td, fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', maxWidth: 180 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.page?.replace(/^https?:\/\/[^/]+/, '') || '/'}</div>
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: r.position <= 3 ? 'var(--green)' : r.position <= 10 ? 'var(--accent)' : r.position <= 20 ? 'var(--amber)' : 'var(--text-2)' }}>
                    avg {typeof r.position === 'number' ? r.position.toFixed(1) : r.position}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)' }}>{(r.clicks || 0).toLocaleString()}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{(r.impressions || 0).toLocaleString()}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{((r.ctr || 0) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Keyword coverage */}
      <div style={{ ...S.panel }}>
        <div style={S.panelHead}><span>Keyword coverage</span></div>
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--text)' }}>Keywords with content</span>
                <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{kw.with_content} / {kw.total}</span>
              </div>
              <div style={{ height: 8, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${kw.total > 0 ? Math.round((kw.with_content / kw.total) * 100) : 0}%`, background: 'var(--accent)', borderRadius: 99, transition: 'width 0.6s' }} />
              </div>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, color: 'var(--accent)', fontWeight: 500, flexShrink: 0 }}>
              {kw.total > 0 ? Math.round((kw.with_content / kw.total) * 100) : 0}%
            </div>
          </div>
        </div>
      </div>

      {/* Opportunities */}
      {nearMiss.length > 0 && (
        <div style={S.panel}>
          <div style={S.panelHead}><span>Near-miss opportunities ({nearMiss.length})</span></div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Keyword</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Avg position</th>
                <th style={{ ...S.th, textAlign: 'right' as const }}>Impressions</th>
                <th style={S.th}>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {nearMiss.map((r: any, i: number) => (
                <tr key={i} style={{ background: 'rgba(245,158,11,0.04)' }}>
                  <td style={{ ...S.td, color: 'var(--text)', fontWeight: 500 }}>{r.query}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--amber)' }}>avg {typeof r.position === 'number' ? r.position.toFixed(1) : r.position}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{(r.impressions || 0).toLocaleString()}</td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--text-2)' }}>Refresh or expand existing content to improve average position and CTR</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20, marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Generated by Agencee · {fmt(report.created_at)}</div>
        {client.website && <a href={client.website} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>{client.website}</a>}
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: #fff !important; color: #000 !important; }
          nav, aside, [data-sidebar] { display: none !important; }
          #report-content { max-width: 100% !important; }
          button, a[href^="/"] { display: none !important; }
        }
      `}</style>
    </div>
  )
}
