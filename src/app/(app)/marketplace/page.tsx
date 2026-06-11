'use client'

const AGENT_TEMPLATES = [
  {
    id: 'ada',
    name: 'Ada — SEO Strategist',
    description: 'Researches keywords, crawls competitors, writes long-form optimised content, and commits directly to GitHub. Built for agencies doing at-scale content production.',
    tags: ['SEO', 'Long-form', 'GitHub'],
    color: 'var(--accent)',
    icon: '✍️',
    installed: true,
  },
  {
    id: 'leo',
    name: 'Leo — Link Builder',
    description: 'Identifies high-authority link opportunities, drafts personalised outreach emails, and tracks campaign progress. Turns backlink building from a chore into a system.',
    tags: ['Link building', 'Outreach', 'PR'],
    color: '#06B6D4',
    icon: '🔗',
    installed: false,
  },
  {
    id: 'iris',
    name: 'Iris — Analytics Interpreter',
    description: 'Reads your GSC and GA4 data, surfaces the insights that matter, and turns numbers into plain-language recommendations your clients will actually understand.',
    tags: ['Analytics', 'GSC', 'GA4'],
    color: 'var(--purple)',
    icon: '📊',
    installed: false,
  },
  {
    id: 'scout',
    name: 'Scout — Competitor Intel',
    description: 'Crawls competitor sites, maps their content strategy, identifies gaps you can exploit, and delivers weekly briefs on what they just published.',
    tags: ['Competitors', 'Intelligence', 'Research'],
    color: 'var(--amber)',
    icon: '🔭',
    installed: false,
  },
  {
    id: 'ellie',
    name: 'Ellie — E-commerce Copywriter',
    description: 'Optimises product descriptions, category pages, and collection copy for Shopify and WooCommerce. Writes with conversion intent and SEO baked in together.',
    tags: ['Shopify', 'WooCommerce', 'Product copy'],
    color: 'var(--green)',
    icon: '🛍️',
    installed: false,
  },
  {
    id: 'theo',
    name: 'Theo — Technical SEO Auditor',
    description: 'Runs deep crawls, identifies structural issues, writes schema markup, and produces actionable fix recommendations with clear priority scoring.',
    tags: ['Technical', 'Schema', 'Audits'],
    color: 'var(--red)',
    icon: '🔧',
    installed: false,
  },
]

export default function Marketplace() {
  return (
    <div>
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.5px' }}>Agent marketplace</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Pre-built agent personas you can add to your workspace. Each comes with its own expertise, working style, and tool configuration.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {AGENT_TEMPLATES.map(t => (
          <div key={t.id} style={{
            background: 'var(--surface)', border: `1px solid ${t.installed ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)',
            padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            opacity: t.installed ? 1 : 0.7,
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 'var(--radius)', background: `color-mix(in srgb, ${t.color} 15%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                  {t.icon}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>{t.name}</div>
                </div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 99,
                background: t.installed ? 'rgba(79,127,255,0.12)' : 'var(--surface-3)',
                color: t.installed ? 'var(--accent)' : 'var(--text-dim)',
                letterSpacing: '0.5px', textTransform: 'uppercase', whiteSpace: 'nowrap',
                border: `1px solid ${t.installed ? 'rgba(79,127,255,0.25)' : 'transparent'}`,
              }}>
                {t.installed ? 'Installed' : 'Coming soon'}
              </span>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>{t.description}</p>

            {/* Tags */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 'auto' }}>
              {t.tags.map(tag => (
                <span key={tag} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 99, background: 'var(--surface-3)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 32, padding: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>Want a custom agent persona?</div>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 0 }}>
          Go to the <a href="/agents" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Agents page</a> and build one from scratch with custom backstory, expertise, and instructions.
        </p>
      </div>
    </div>
  )
}
