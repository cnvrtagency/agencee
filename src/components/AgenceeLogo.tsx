'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'

function PersonIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.18)} viewBox="0 0 22 26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="11" cy="7" r="5" />
      <path d="M1 25c0-5.523 4.477-10 10-10s10 4.477 10 10" />
    </svg>
  )
}

interface AgenceeLogoProps {
  variant?: 'splash' | 'sidebar' | 'header'
  animate?: boolean
}

const SIZES = {
  splash:  { width: 260, icon: 19, centerIcon: 23, gap: 9 },
  sidebar: { width: 128, icon: 9,  centerIcon: 11, gap: 4 },
}

export default function AgenceeLogo({ variant = 'splash', animate = true }: AgenceeLogoProps) {
  const [wordmarkVisible, setWordmarkVisible] = useState(!animate)
  const [iconsVisible, setIconsVisible] = useState<number[]>(animate ? [] : [0,1,2,3,4])

  useEffect(() => {
    if (!animate) return
    const t1 = setTimeout(() => setWordmarkVisible(true), 200)
    const timers = [650, 850, 1050, 1250, 1450].map((delay, i) =>
      setTimeout(() => setIconsVisible(prev => [...prev, i]), delay)
    )
    return () => { clearTimeout(t1); timers.forEach(clearTimeout) }
  }, [animate])

  const s = SIZES[variant as keyof typeof SIZES] ?? SIZES.sidebar

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: variant === 'splash' ? 10 : 4, userSelect: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: s.gap }}>
        {[0,1,2,3,4].map(i => {
          const isCenter = i === 2
          const visible = iconsVisible.includes(i)
          return (
            <div key={i} style={{
              color: isCenter ? 'rgba(200,240,208,0.72)' : 'rgba(200,240,208,0.35)',
              opacity: visible ? 1 : 0,
              transform: visible
                ? `translateY(0) scale(${isCenter ? 1.15 : 1})`
                : `translateY(6px) scale(${isCenter ? 1.15 : 1})`,
              transition: 'opacity 0.28s ease, transform 0.28s ease',
            }}>
              <PersonIcon size={isCenter ? s.centerIcon : s.icon} />
            </div>
          )
        })}
      </div>
      <div style={{
        opacity: wordmarkVisible ? 1 : 0,
        transform: wordmarkVisible ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 0.5s ease, transform 0.5s ease',
      }}>
        <Image
          src="/agencee-logo.png"
          alt="Agencee"
          width={s.width}
          height={Math.round(s.width * (370 / 1176))}
          priority
        />
      </div>
    </div>
  )
}
