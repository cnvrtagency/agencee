const config: Record<string, { label: string; color: string; bg: string }> = {
  queued:    { label: 'Queued',    color: 'var(--text-2)',  bg: 'rgba(122,139,168,0.12)' },
  running:   { label: 'Running',   color: 'var(--amber)',   bg: 'var(--amber-bg)' },
  review:    { label: 'Review',    color: 'var(--purple)',  bg: 'var(--purple-bg)' },
  done:      { label: 'Done',      color: 'var(--green)',   bg: 'var(--green-bg)' },
  failed:    { label: 'Failed',    color: 'var(--red)',     bg: 'var(--red-bg)' },
  draft:     { label: 'Draft',     color: 'var(--text-2)',  bg: 'rgba(122,139,168,0.12)' },
  ready:     { label: 'Ready',     color: 'var(--green)',   bg: 'var(--green-bg)' },
  scheduled: { label: 'Scheduled', color: 'var(--accent)',  bg: 'var(--accent-bg)' },
}

export default function StatusBadge({ status, error }: { status: string; error?: string }) {
  const c = config[status] ?? { label: status, color: 'var(--text-2)', bg: 'rgba(122,139,168,0.12)' }
  const isRunning = status === 'running'

  return (
    <span
      title={error || undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 9px', borderRadius: 99,
        background: c.bg, color: c.color,
        fontSize: 11, fontWeight: 600, letterSpacing: '0.4px',
        whiteSpace: 'nowrap', cursor: error ? 'help' : 'default',
        border: '1px solid transparent',
        borderColor: isRunning ? 'rgba(245,166,35,0.25)' : 'transparent',
      }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%',
        background: c.color, flexShrink: 0,
        animation: isRunning ? 'pulse 1.2s ease-in-out infinite' : 'none',
      }} />
      {c.label}
      {/* Inline keyframes so the component is self-contained */}
      <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
    </span>
  )
}
