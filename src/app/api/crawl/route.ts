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
      headers: { 'User-Agent': 'Agencee-Crawler/1.0 (site audit bot)' },
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

export async function POST(req: NextRequest) {
  const { client_id, website } = await req.json()
  if (!client_id || !website) {
    return NextResponse.json({ error: 'client_id and website required' }, { status: 400 })
  }

  const baseUrl = website.replace(/\/$/, '')
  const visited = new Set<string>()
  const queue: string[] = [baseUrl]
  const pages: any[] = []
  const maxPages = 60

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

    for (const link of links) {
      if (!visited.has(link) && !queue.includes(link)) queue.push(link)
    }
  }

  if (pages.length === 0) {
    return NextResponse.json({ error: 'Could not crawl site. Check the URL is correct and publicly accessible.' }, { status: 400 })
  }

  // Delete old crawl data
  await supabase.from('site_pages').delete().eq('client_id', client_id)

  // Insert in batches
  const batchSize = 20
  for (let i = 0; i < pages.length; i += batchSize) {
    await supabase.from('site_pages').insert(pages.slice(i, i + batchSize))
  }

  await supabase.from('client_profiles').update({ last_crawled_at: new Date().toISOString() }).eq('id', client_id)

  return NextResponse.json({ success: true, pages_crawled: pages.length })
}
