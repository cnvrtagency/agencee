'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'

function PersonIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.18)} viewBox="0 0 22 26" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="11" cy="7" r="5" />
      <path d="M1 25c0-5.523 4.477-10 10-10s10 4.477 10 10" />
    </svg>
  )
}

const SIZES = {
  splash:  { width: 240, icon: 18, center: 22, gap: 8 },
  sidebar: { width: 118, icon: 8,  center: 10, gap: 3 },
}

export default function AgenceeLogo({ variant = 'splash', animate = true }: { variant?: 'splash' | 'sidebar'; animate?: boolean }) {
  const [phase, setPhase] = useState(animate ? 0 : 6)
  const s = SIZES[variant] ?? SIZES.sidebar

  useEffect(() => {
    if (!animate) return
    const t0 = setTimeout(() => setPhase(1), 80)
    const t1 = setTimeout(() => setPhase(2), 400)
    const t2 = setTimeout(() => setPhase(3), 520)
    const t3 = setTimeout(() => setPhase(4), 640)
    const t4 = setTimeout(() => setPhase(5), 760)
    const t5 = setTimeout(() => setPhase(6), 880)
    return () => [t0, t1, t2, t3, t4, t5].forEach(clearTimeout)
  }, [animate])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: variant === 'splash' ? 8 : 3, userSelect: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: s.gap }}>
        {[0, 1, 2, 3, 4].map(i => {
          const isCenter = i === 2
          const visible = phase >= i + 2
          return (
            <div
              key={i}
              className={`logo-icon${visible ? ' visible' : ''}`}
              style={{
                color: isCenter ? 'rgba(200,240,208,0.75)' : 'rgba(200,240,208,0.38)',
                transform: visible
                  ? `scale(${isCenter ? 1.18 : 1})`
                  : `translateY(5px) scale(${isCenter ? 1.18 : 1})`,
              }}
            >
              <PersonIcon size={isCenter ? s.center : s.icon} />
            </div>
          )
        })}
      </div>
      <div className={`logo-wordmark${phase >= 1 ? ' visible' : ''}`}>
        <Image
          src="/agencee-logo.png"
          alt="Agencee"
          width={s.width}
          height={Math.round(s.width * (370 / 1176))}
          priority
          fetchPriority="high"
        />
      </div>
    </div>
  )
}
