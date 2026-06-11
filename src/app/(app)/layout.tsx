'use client'
import { useState } from 'react'
import Sidebar from '@/components/Sidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ display: 'flex', minHeight: '100dvh', background: 'var(--bg)' }}>
      {/* Sidebar */}
      <div
        className="sidebar-fixed"
        data-open={open}
        style={{ position: 'fixed', inset: '0 auto 0 0', width: 220, zIndex: 50, transition: 'transform 0.24s var(--ease)' }}
      >
        <Sidebar onClose={() => setOpen(false)} />
      </div>

      {/* Mobile backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }}
        />
      )}

      {/* Content */}
      <div className="app-main" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Mobile bar */}
        <div
          className="mobile-bar"
          style={{
            alignItems: 'center', height: 52, padding: '0 16px',
            background: 'var(--brand)', borderBottom: '1px solid rgba(200,240,208,0.1)',
            position: 'sticky', top: 0, zIndex: 30, gap: 12,
          }}
        >
          <button
            onClick={() => setOpen(true)}
            style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'rgba(200,240,208,0.1)', border: '1px solid rgba(200,240,208,0.2)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--brand-accent)', flexShrink: 0,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>

        <div className="app-pad" style={{ flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  )
}
