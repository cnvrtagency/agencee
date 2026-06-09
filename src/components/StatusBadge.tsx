const config: Record<string, { label: string; color: string; bg: string }> = {
  queued:    { label: 'Queued',    color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)' },
  running:   { label: 'Running',   color: 'var(--amber)',      bg: 'var(--amber-bg)' },
  review:    { label: 'Review',    color: 'var(--accent)',     bg: 'var(--accent-bg)' },
  done:      { label: 'Done',      color: 'var(--green)',      bg: 'var(--green-bg)' },
  failed:    { label: 'Failed',    color: 'var(--red)',        bg: 'var(--red-bg)' },
  draft:     { label: 'Draft',     color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)' },
  ready:     { label: 'Ready',     color: 'var(--green)',      bg: 'var(--green-bg)' },
  scheduled: { label: 'Scheduled', color: 'var(--accent)',     bg: 'var(--accent-bg)' },
}

export default function StatusBadge({ status }: { status: string }) {
  const c = config[status] ?? { label: status, color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 99, background: c.bg, color: c.color, fontSize: 11, fontWeight: 500, letterSpacing: '0.3px', whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.color, flexShrink: 0, animation: status === 'running' ? 'pulse 1.4s ease-in-out infinite' : 'none' }} />
      {c.label}
      <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
    </span>
  )
}
