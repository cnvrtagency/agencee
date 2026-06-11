'use client'
import { useState } from 'react'
import Sidebar from '@/components/Sidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div style={{ display: 'flex', minHeight: '100dvh', background: 'var(--bg)' }}>
      {/* Sidebar */}
      <aside
        style={{
          position: 'fixed',
          top: 0, left: 0, bottom: 0,
          width: 220,
          zIndex: 50,
          transition: 'transform 0.25s ease',
        }}
        className="sidebar-panel"
        data-open={sidebarOpen}
      >
        <Sidebar />
      </aside>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 40 }}
          className="md-hidden"
        />
      )}

      {/* Main content */}
      <main style={{ flex: 1, minWidth: 0, maxWidth: '100%' }} className="app-main">
        {/* Mobile header bar */}
        <div className="mobile-header" style={{ display: 'none', alignItems: 'center', height: 52, padding: '0 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 30 }}>
          <button
            onClick={() => setSidebarOpen(true)}
            style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--brand-bg)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
        </div>

        <div style={{ padding: '40px 44px' }} className="app-content">
          {children}
        </div>
      </main>
    </div>
  )
}
