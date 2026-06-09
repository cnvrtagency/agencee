type Status = 'queued' | 'running' | 'review' | 'done' | 'failed' | string

const config: Record<string, { label: string; color: string; dot: string }> = {
  queued:  { label: 'Queued',  color: '#8B91A8', dot: '#8B91A8' },
  running: { label: 'Running', color: '#F59E0B', dot: '#F59E0B' },
  review:  { label: 'Review',  color: '#6366F1', dot: '#6366F1' },
  done:    { label: 'Done',    color: '#34D399', dot: '#34D399' },
  failed:  { label: 'Failed',  color: '#F87171', dot: '#F87171' },
}

export default function StatusBadge({ status }: { status: Status }) {
  const c = config[status] ?? { label: status, color: '#8B91A8', dot: '#8B91A8' }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '3px 8px',
      borderRadius: '20px',
      fontSize: '12px',
      fontWeight: 500,
      background: c.color + '18',
      color: c.color,
    }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: c.dot,
        flexShrink: 0,
        animation: status === 'running' ? 'pulse 1.4s infinite' : 'none',
      }} />
      {c.label}
      <style>{`@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>
    </span>
  )
}
