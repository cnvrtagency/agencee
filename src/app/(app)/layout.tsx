'use client'
import Sidebar from '@/components/Sidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100dvh', background: 'var(--bg)' }}>
      <Sidebar />
      <main style={{
        marginLeft: 240,
        flex: 1,
        padding: '40px 44px',
        minWidth: 0,
        maxWidth: '100%',
      }}>
        {children}
      </main>
    </div>
  )
}
