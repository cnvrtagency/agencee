// Single source of truth for all design tokens.
// To white-label: change values here. Nothing else needs touching.

export const T = {
  // Backgrounds
  bg:         '#030507',
  surface:    '#0C0F16',
  surface2:   '#131820',
  surface3:   '#181D28',

  // Borders
  border:     'rgba(255,255,255,0.07)',
  borderMid:  'rgba(255,255,255,0.11)',

  // Text
  text:       '#EDEEF2',
  textMuted:  '#6B7280',
  textDim:    '#374151',

  // Accent
  accent:     '#6366F1',
  accentHover:'#818CF8',
  accentGlow: 'rgba(99,102,241,0.15)',
  accentBg:   'rgba(99,102,241,0.08)',

  // Status
  green:      '#22C55E',
  greenBg:    'rgba(34,197,94,0.1)',
  amber:      '#F59E0B',
  amberBg:    'rgba(245,158,11,0.1)',
  red:        '#EF4444',
  redBg:      'rgba(239,68,68,0.1)',

  // Fonts
  fontSans:   '"Inter", system-ui, sans-serif',
  fontMono:   '"JetBrains Mono", monospace',
  fontDisplay:'"Calistoga", serif',

  // Radius
  radius:     8,
  radiusMd:   10,
  radiusLg:   14,

  // Transitions
  transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
} as const
