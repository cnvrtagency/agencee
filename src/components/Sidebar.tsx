'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/',         label: 'Dashboard' },
  { href: '/agents',   label: 'Agents'    },
  { href: '/clients',  label: 'Clients'   },
  { href: '/queue',    label: 'Queue'     },
  { href: '/outputs',  label: 'Outputs'   },
]

export default function Sidebar() {
  const path = usePathname()

  return (
    <aside style={{
      width: 220, flexShrink: 0, background: '#0A0C10',
      borderRight: '1px solid #252836', display: 'flex',
      flexDirection: 'column', padding: '24px 0',
      position: 'fixed', top: 0, left: 0, bottom: 0,
    }}>
      <div style={{ padding: '0 20px 28px' }}>
        <span style={{ fontFamily: '"Instrument Serif", serif', fontSize: 22, color: '#E2E4EE', letterSpacing: '0.2px' }}>
          Agencee
        </span>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 10px' }}>
        {nav.map(({ href, label }) => {
          const active = href === '/' ? path === '/' : path.startsWith(href)
          return (
            <Link key={href} href={href} style={{
              display: 'flex', alignItems: 'center', padding: '9px 12px',
              borderRadius: 7, fontSize: 14, fontWeight: active ? 500 : 400,
              color: active ? '#E2E4EE' : '#8B91A8',
              background: active ? '#1C1F2A' : 'transparent',
              textDecoration: 'none',
              borderLeft: active ? '2px solid #6366F1' : '2px solid transparent',
              transition: 'all 0.12s',
            }}>
              {label}
            </Link>
          )
        })}
      </nav>
      <div style={{ marginTop: 'auto', padding: '20px' }}>
        <div style={{ fontSize: 11, color: '#3A3D4A', letterSpacing: '1.5px', textTransform: 'uppercase' }}>v0.1</div>
      </div>
    </aside>
  )
}
