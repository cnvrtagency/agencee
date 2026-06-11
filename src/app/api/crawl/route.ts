import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

function normaliseUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base)
    const baseHost = new URL(base).hostname
    if (url.hostname !== baseHost) return null
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.pathname.match(/\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|ico|xml|txt)$/i)) return null
    url.hash = ''
    const clean = url.toString().replace(/\/$/, '') || url.origin
    return clean
  } catch { return null }
}

function extractText(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'))
  return match ? match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim() : null
}

function extractMeta(html: string, name: string): string | null {
  const match = html.match(new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, 'i'))
  return match ? match[1].trim() : null
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = []
  const regex = /href=["']([^"'#][^"']*)["']/gi
  let m
  while ((m = regex.exec(html)) !== null) {
    const url = normaliseUrl(m[1], baseUrl)
    if (url && !links.includes(url)) links.push(url)
  }
  return links
}

function extractContent(html: string): string {
  // Remove scripts, styles, nav, header, footer, aside
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return text.slice(0, 20000)
}

function extractHeadings(html: string): string[] {
  const headings: string[] = []
  const regex = /<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi
  let m
  while ((m = regex.exec(html)) !== null) {
    const text = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
    if (text) headings.push(text)
  }
  return headings.slice(0, 10)
}

function buildSummary(title: string | null, h1: string | null, headings: string[], content: string): string {
  const parts: string[] = []
  if (h1) parts.push(`Page about: ${h1}`)
  else if (title) parts.push(`Page: ${title}`)
  if (headings.length > 0) parts.push(`Covers: ${headings.slice(0, 5).join(', ')}`)
  // Extract first meaningful sentence from content
  const firstSentence = content.match(/[A-Z][^.!?]{20,150}[.!?]/)
  if (firstSentence) parts.push(firstSentence[0].trim())
  return parts.join('. ')
}

function countWords(html: string): number {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.split(' ').filter(w => w.length > 0).length
}

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) return null
    const html = await res.text()
    return { html, finalUrl: res.url }
  } catch { return null }
}

async function fetchSitemapUrls(baseUrl: string): Promise<string[]> {
  const candidates = [
    `${baseUrl}/sitemap.xml`,
    `${baseUrl}/sitemap_index.xml`,
    `${baseUrl}/sitemap/`,
    `${baseUrl}/sitemap`,
  ]
  for (const sitemapUrl of candidates) {
    try {
      const res = await fetch(sitemapUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xml,application/xhtml+xml,text/xml,*/*',
        },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) continue
      const text = await res.text()
      if (!text.includes('<urlset') && !text.includes('<sitemapindex')) continue
      if (text.includes('<sitemapindex')) {
        const subSitemapUrls = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim())
        const allUrls: string[] = []
        for (const subUrl of subSitemapUrls.slice(0, 5)) {
          try {
            const subRes = await fetch(subUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
              signal: AbortSignal.timeout(8000),
            })
            if (!subRes.ok) continue
            const subText = await subRes.text()
            const urls = [...subText.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim())
            allUrls.push(...urls)
          } catch { continue }
        }
        return allUrls
      }
      const urls = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim())
      return urls
    } catch { continue }
  }
  return []
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const { client_id, website, competitor_id } = body

  // Competitor crawl mode
  if (competitor_id) {
    const { data: comp } = await supabase.from('competitor_sites').select('url, name').eq('id', competitor_id).single()
    if (!comp?.url) return NextResponse.json({ error: 'Competitor site not found or has no URL' }, { status: 400 })

    // Resolve workspace_id for competitor pages — same fallback chain as normal crawl
    let compWorkspaceId: string | null = null
    if (client_id) {
      const { data: gcRow2 } = await supabase.from('google_connections').select('workspace_id').eq('client_id', client_id).maybeSingle()
      compWorkspaceId = gcRow2?.workspace_id ?? null
      if (!compWorkspaceId) {
        const { data: cpRow2 } = await supabase.from('client_profiles').select('workspace_id').eq('id', client_id).maybeSingle()
        compWorkspaceId = cpRow2?.workspace_id ?? null
      }
    }
    if (!compWorkspaceId) {
      const { data: wsRow2 } = await supabase.from('workspaces').select('id').limit(1).maybeSingle()
      compWorkspaceId = wsRow2?.id ?? null
    }

    const baseUrl = comp.url.replace(/\/$/, '')
    const visited = new Set<string>()
    const pages: any[] = []
    const maxPages = 40
    // Try sitemap first
    let queue: string[] = []
    let usingSitemap = false
    const sitemapUrls = await fetchSitemapUrls(baseUrl)
    if (sitemapUrls.length > 0) {
      const host = new URL(baseUrl).hostname
      queue = sitemapUrls
        .filter(u => {
          try {
            const parsed = new URL(u)
            return parsed.hostname === host && !u.match(/\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|ico|xml|txt)$/i)
          } catch { return false }
        })
        .slice(0, maxPages)
      usingSitemap = queue.length > 0
    }
    if (!usingSitemap) queue = [baseUrl]

    while (queue.length > 0 && pages.length < maxPages) {
      const url = queue.shift()!
      if (visited.has(url)) continue
      visited.add(url)
      const result = await fetchPage(url)
      if (!result) continue
      const { html, finalUrl } = result
      visited.add(finalUrl)
      const title = extractText(html, 'title')
      const h1 = extractText(html, 'h1')
      const metaDesc = extractMeta(html, 'description')
      const wordCount = countWords(html)
      const content = extractContent(html)
      pages.push({ workspace_id: compWorkspaceId, competitor_id, client_id, url: finalUrl, title, h1, meta_description: metaDesc, word_count: wordCount, content, crawled_at: new Date().toISOString() })
      if (!usingSitemap) {
        for (const link of extractLinks(html, finalUrl)) {
          if (!visited.has(link) && !queue.includes(link)) queue.push(link)
        }
      }
    }

    if (pages.length === 0) return NextResponse.json({ error: 'Could not crawl competitor site.' }, { status: 400 })

    await supabase.from('competitor_pages').delete().eq('competitor_id', competitor_id)
    const batchSize = 20
    for (let i = 0; i < pages.length; i += batchSize) {
      await supabase.from('competitor_pages').insert(pages.slice(i, i + batchSize))
    }
    await supabase.from('competitor_sites').update({ last_crawled_at: new Date().toISOString() }).eq('id', competitor_id)

    // Generate content summaries for competitor pages using Haiku
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (apiKey && pages.length > 0) {
      const pagesToSummarise = pages.slice(0, 20)
      const summaries = await Promise.all(
        pagesToSummarise.map(async (page) => {
          if (!page.content || page.content.length < 100) return { url: page.url, summary: null }
          try {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 200,
                messages: [{
                  role: 'user',
                  content: `Summarise this page in 1-2 sentences. Focus on: what service or topic it covers, what keywords it appears to target, and who it's for. Be specific and concrete.\n\nPage title: ${page.title || 'Unknown'}\nURL: ${page.url}\nContent (first 800 chars):\n${page.content.slice(0, 800)}`,
                }],
              }),
            })
            const data = await res.json()
            const summary = data.content?.[0]?.text?.trim() || null
            return { url: page.url, summary }
          } catch {
            return { url: page.url, summary: null }
          }
        })
      )
      for (const { url, summary } of summaries) {
        if (summary) {
          await supabase
            .from('competitor_pages')
            .update({ content_summary: summary })
            .eq('competitor_id', competitor_id)
            .eq('url', url)
        }
      }
    }

    return NextResponse.json({ success: true, pages_crawled: pages.length, competitor: comp.name })
  }

  // Normal site crawl mode
  if (!client_id || !website) {
    return NextResponse.json({ error: 'client_id and website required' }, { status: 400 })
  }

  // Resolve workspace_id — fallback chain: google_connections → client_profiles → first workspace
  let workspaceId: string | null = null
  const { data: gcRow } = await supabase.from('google_connections').select('workspace_id').eq('client_id', client_id).maybeSingle()
  workspaceId = gcRow?.workspace_id ?? null
  if (!workspaceId) {
    const { data: cpRow } = await supabase.from('client_profiles').select('workspace_id').eq('id', client_id).maybeSingle()
    workspaceId = cpRow?.workspace_id ?? null
  }
  if (!workspaceId) {
    const { data: wsRow } = await supabase.from('workspaces').select('id').limit(1).maybeSingle()
    workspaceId = wsRow?.id ?? null
  }

  const baseUrl = website.replace(/\/$/, '')
  const visited = new Set<string>()
  const pages: any[] = []
  const maxPages = 60
  // Try sitemap first — gives a clean URL list without link crawling
  let queue: string[] = []
  let usingSitemap = false
  const sitemapUrls = await fetchSitemapUrls(baseUrl)
  if (sitemapUrls.length > 0) {
    const host = new URL(baseUrl).hostname
    queue = sitemapUrls
      .filter(u => {
        try {
          const parsed = new URL(u)
          return parsed.hostname === host && !u.match(/\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|ico|xml|txt)$/i)
        } catch { return false }
      })
      .slice(0, maxPages)
    usingSitemap = queue.length > 0
  }
  if (!usingSitemap) queue = [baseUrl]

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift()!
    if (visited.has(url)) continue
    visited.add(url)

    const result = await fetchPage(url)
    if (!result) continue

    const { html, finalUrl } = result
    visited.add(finalUrl)

    const title = extractText(html, 'title')
    const h1 = extractText(html, 'h1')
    const metaDesc = extractMeta(html, 'description')
    const wordCount = countWords(html)
    const links = extractLinks(html, finalUrl)
    const content = extractContent(html)
    const headings = extractHeadings(html)
    const summary = buildSummary(title, h1, headings, content)

    pages.push({
      workspace_id: workspaceId,
      client_id,
      url: finalUrl,
      title,
      h1,
      meta_description: metaDesc,
      word_count: wordCount,
      internal_links: links.slice(0, 30),
      content,
      content_summary: summary,
      crawled_at: new Date().toISOString(),
    })

    if (!usingSitemap) {
      for (const link of links) {
        if (!visited.has(link) && !queue.includes(link)) queue.push(link)
      }
    }
  }

  if (pages.length === 0) {
    return NextResponse.json({ error: 'Could not crawl site. Check the URL is correct and publicly accessible.' }, { status: 400 })
  }

  // Delete old crawl data
  const { error: deleteError } = await supabase.from('site_pages').delete().eq('client_id', client_id)
  if (deleteError) {
    return NextResponse.json({ error: `Failed to clear old crawl data: ${deleteError.message}` }, { status: 500 })
  }

  // Insert in batches
  const batchSize = 20
  for (let i = 0; i < pages.length; i += batchSize) {
    const { error: insertError } = await supabase.from('site_pages').insert(pages.slice(i, i + batchSize))
    if (insertError) {
      return NextResponse.json({ error: `Insert failed at batch ${i / batchSize}: ${insertError.message}` }, { status: 500 })
    }
  }

  await supabase.from('client_profiles').update({ last_crawled_at: new Date().toISOString() }).eq('id', client_id)

  // Update knowledge panel cache with fresh site inventory
  const pageInventory = pages.map((p: any) => ({
    url: p.url,
    title: p.title,
    h1: p.h1,
    meta_description: p.meta_description,
    word_count: p.word_count,
  }))
  const siteSummary = `${pageInventory.length} pages crawled. ` +
    `${pageInventory.filter((p: any) => !p.meta_description).length} missing meta descriptions. ` +
    `${pageInventory.filter((p: any) => (p.word_count || 0) < 300).length} thin pages (under 300 words).`
  await supabase.from('client_knowledge').upsert({
    client_id,
    workspace_id: workspaceId,
    site_pages: pageInventory,
    site_pages_updated_at: new Date().toISOString(),
    site_summary: siteSummary,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id' })

  // Generate content summary via Haiku — runs after site_pages are written
  try {
    const [{ data: contentHistory }, { data: keywordBank }] = await Promise.all([
      supabase.from('content_history')
        .select('title, published_at, primary_keyword')
        .eq('client_id', client_id)
        .order('published_at', { ascending: false })
        .limit(30),
      supabase.from('keyword_banks')
        .select('keyword, intent, content_targeting_this')
        .eq('client_id', client_id)
        .limit(50),
    ])

    const publishedTitles = (contentHistory || [])
      .map((c: any) => `- "${c.title}" (${c.primary_keyword || 'no keyword'}, ${c.published_at ? new Date(c.published_at).toLocaleDateString('en-GB') : 'unknown'})`)
      .join('\n')

    const targeted = (keywordBank || []).filter((k: any) => k.content_targeting_this).length
    const total = (keywordBank || []).length

    const summaryPrompt = `You are an SEO analyst. Write a 2-3 sentence summary of this client's content state. Be specific and factual. UK English. No em dashes. No filler.

Published content (${contentHistory?.length || 0} pieces):
${publishedTitles || 'None'}

Keyword bank: ${total} keywords total, ${targeted} have content targeting them.

Summarise: what topics are covered, what is the overall content depth, and what is the most obvious gap.`

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: summaryPrompt }],
      }),
    })

    if (aiRes.ok) {
      const aiData = await aiRes.json()
      const contentSummary = aiData.content?.[0]?.text?.trim()
      if (contentSummary) {
        await supabase.from('client_knowledge').upsert({
          client_id,
          workspace_id: workspaceId,
          content_summary: contentSummary,
          content_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id' })
      }
    }
  } catch { /* non-critical — don't block crawl response */ }

  return NextResponse.json({ success: true, pages_crawled: pages.length, workspace_id: workspaceId })
}
