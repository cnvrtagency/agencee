import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forbiddenResponse, requireUser, userCanAccessClient } from '@/lib/server/auth'
import { checkRateLimit, getRateLimitIdentity } from '@/lib/server/rate-limit'
import { readJsonWithLimit } from '@/lib/server/request-body'
import { checkUserBudget, recordTokenUsage } from '@/lib/server/token-usage'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const maxDuration = 60
const FETCH_TIMEOUT_MS = 12_000
const SITEMAP_FETCH_TIMEOUT_MS = 25_000
const CRAWL_CONCURRENCY = 5
const CLIENT_MAX_PAGES = 50
const COMPETITOR_MAX_PAGES = 40
const MAX_SITEMAPS_TO_CHECK = 30
const MAX_SITEMAP_URLS = 500

const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
}

const SITEMAP_HEADERS = {
  ...PAGE_HEADERS,
  'Accept': 'application/xml,text/xml,text/plain,text/html,*/*',
}

function normaliseUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base)
    const baseHost = new URL(base).hostname
    if (!sameSiteHost(url.hostname, baseHost)) return null
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!isCrawlablePageUrl(url.toString())) return null
    url.hash = ''
    const clean = url.toString().replace(/\/$/, '') || url.origin
    return clean
  } catch { return null }
}

function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

function sameSiteHost(a: string, b: string): boolean {
  return stripWww(a) === stripWww(b)
}

function siteOrigin(value: string): string {
  const url = new URL(value)
  return url.origin
}

function normaliseBaseUrl(value: string): string | null {
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`
    const url = new URL(withProtocol)
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()
}

function isAssetUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return /\.(pdf|jpg|jpeg|png|gif|svg|webp|avif|css|js|ico|xml|txt|zip|mp4|mp3|mov|woff|woff2|ttf)$/i.test(url.pathname)
  } catch {
    return /\.(pdf|jpg|jpeg|png|gif|svg|webp|avif|css|js|ico|xml|txt|zip|mp4|mp3|mov|woff|woff2|ttf)(?:$|\?)/i.test(value)
  }
}

function isCrawlablePageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (isAssetUrl(value)) return false
    const path = url.pathname.toLowerCase()
    if (/\/(wp-json|feed|tag|author|cart|checkout|my-account|account|login|privacy-policy|terms|cookie-policy)(\/|$)/.test(path)) return false
    if (/[?&](replytocom|share|add-to-cart)=/i.test(url.search)) return false
    return true
  } catch {
    return false
  }
}

function extractXmlLocs(xml: string): string[] {
  const locs: string[] = []
  const regex = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi
  let match
  while ((match = regex.exec(xml)) !== null) {
    const loc = decodeEntities(match[1])
    if (loc && !locs.includes(loc)) locs.push(loc)
  }
  return locs
}

function uniqueUrls(urls: string[]): string[] {
  return [...new Set(urls.filter(Boolean))]
}

function prioritiseUrls(urls: string[], startUrl: string, max: number): string[] {
  const origin = siteOrigin(startUrl)
  const scored = uniqueUrls(urls).map(url => {
    let score = 0
    try {
      const parsed = new URL(url)
      const path = parsed.pathname.toLowerCase()
      if (parsed.origin === origin && (path === '/' || path === '')) score += 100
      if (/\/(services?|solutions?|products?|locations?|areas?|pricing|about|contact)(\/|$)/.test(path)) score += 25
      if (/\b(service|solution|pricing|cost|near-me|nearby|location|city|town)\b/.test(path)) score += 15
      if (/\/(blog|news|guides?|advice|articles?|resources?)(\/|$)/.test(path)) score += 8
      if (/\/(category|tag|author|page)\/|\/page\/\d+/i.test(path)) score -= 20
      if (/privacy|terms|cookie|login|checkout|cart|account/i.test(path)) score -= 50
      score -= Math.max(parsed.pathname.split('/').filter(Boolean).length - 3, 0)
    } catch {
      score -= 100
    }
    return { url, score }
  })
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map(item => item.url)
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

type FetchPageSuccess = { ok: true; html: string; finalUrl: string }
type FetchPageFailure = {
  ok: false
  url: string
  finalUrl?: string
  reason: string
  status?: number
  contentType?: string
}
type FetchPageResult = FetchPageSuccess | FetchPageFailure
type SitemapDiscovery = {
  urls: string[]
  checked: string[]
  failures: FetchPageFailure[]
}

function describeFetchFailure(failure: FetchPageFailure): string {
  const context = [
    failure.status ? `status ${failure.status}` : null,
    failure.contentType ? `content-type ${failure.contentType}` : null,
    failure.finalUrl && failure.finalUrl !== failure.url ? `final URL ${failure.finalUrl}` : null,
  ].filter(Boolean)
  return `${failure.url}: ${failure.reason}${context.length > 0 ? ` (${context.join(', ')})` : ''}`
}

function noPagesDetails(input: { attempted: number; sitemapUrlCount: number; usingSitemap: boolean; failures: FetchPageFailure[] }): string {
  const source = input.sitemapUrlCount > 0
    ? `Found ${input.sitemapUrlCount} sitemap URL(s)${input.usingSitemap ? '' : ', but none were crawlable HTML page URLs'}.`
    : 'No sitemap URLs found, so the crawler started from the homepage.'
  const failures = input.failures.length > 0
    ? ` First failures: ${input.failures.slice(0, 3).map(describeFetchFailure).join(' | ')}`
    : ' No HTML pages were discoverable from the start URL.'
  return `Tried ${input.attempted} URL(s). ${source}${failures}`
}

async function fetchPage(url: string): Promise<FetchPageResult> {
  try {
    const res = await fetch(url, {
      headers: PAGE_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const contentType = res.headers.get('content-type') || ''
    if (!res.ok) {
      return { ok: false, url, finalUrl: res.url, status: res.status, contentType, reason: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}` }
    }
    if (!contentType.toLowerCase().includes('text/html')) {
      return { ok: false, url, finalUrl: res.url, status: res.status, contentType, reason: `Expected HTML but received ${contentType || 'no content type'}` }
    }
    const html = await res.text()
    return { ok: true, html, finalUrl: res.url }
  } catch (error) {
    const err = error as Error
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return { ok: false, url, reason: timedOut ? `Timed out after ${Math.round(FETCH_TIMEOUT_MS / 1000)} seconds` : err?.message || 'Request failed' }
  }
}

async function fetchText(url: string): Promise<{ ok: true; text: string; finalUrl: string; contentType: string } | FetchPageFailure> {
  try {
    const res = await fetch(url, {
      headers: SITEMAP_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(SITEMAP_FETCH_TIMEOUT_MS),
    })
    const contentType = res.headers.get('content-type') || ''
    if (!res.ok) {
      return { ok: false, url, finalUrl: res.url, status: res.status, contentType, reason: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}` }
    }
    return { ok: true, text: await res.text(), finalUrl: res.url, contentType }
  } catch (error) {
    const err = error as Error
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return { ok: false, url, reason: timedOut ? `Timed out after ${Math.round(SITEMAP_FETCH_TIMEOUT_MS / 1000)} seconds` : err?.message || 'Request failed' }
  }
}

async function fetchRobotsSitemaps(origin: string): Promise<string[]> {
  const result = await fetchText(`${origin}/robots.txt`)
  if (!result.ok) return []
  return result.text
    .split(/\n/)
    .map(line => line.match(/^\s*sitemap:\s*(.+)\s*$/i)?.[1]?.trim())
    .filter((value): value is string => Boolean(value))
}

async function fetchSitemapUrls(baseUrl: string): Promise<SitemapDiscovery> {
  const origin = siteOrigin(baseUrl)
  const robotsSitemaps = await fetchRobotsSitemaps(origin)
  const candidates = uniqueUrls([
    ...robotsSitemaps,
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/wp-sitemap.xml`,
    `${origin}/page-sitemap.xml`,
    `${origin}/post-sitemap.xml`,
    `${origin}/sitemap/`,
    `${origin}/sitemap`,
  ])
  const queue = [...candidates]
  const checked: string[] = []
  const failures: FetchPageFailure[] = []
  const pageUrls: string[] = []
  const baseHost = new URL(baseUrl).hostname

  while (queue.length > 0 && checked.length < MAX_SITEMAPS_TO_CHECK && pageUrls.length < MAX_SITEMAP_URLS) {
    const sitemapUrl = queue.shift()!
    if (checked.includes(sitemapUrl)) continue
    checked.push(sitemapUrl)

    const result = await fetchText(sitemapUrl)
    if (!result.ok) {
      failures.push(result)
      continue
    }

    const locs = extractXmlLocs(result.text)
    if (locs.length === 0) continue

    const isIndex = /<sitemapindex[\s>]/i.test(result.text)
    for (const loc of locs) {
      try {
        const parsed = new URL(loc)
        if (!sameSiteHost(parsed.hostname, baseHost)) continue
        if (isIndex || parsed.pathname.toLowerCase().endsWith('.xml')) {
          if (!checked.includes(loc) && !queue.includes(loc)) queue.push(loc)
          continue
        }
        if (isCrawlablePageUrl(loc)) pageUrls.push(loc)
      } catch {
        continue
      }
    }
  }

  return { urls: uniqueUrls(pageUrls).slice(0, MAX_SITEMAP_URLS), checked, failures }
}

async function crawlPageQueue(input: {
  initialQueue: string[]
  maxPages: number
  usingSitemap: boolean
  buildPage: (args: {
    html: string
    finalUrl: string
    title: string | null
    h1: string | null
    metaDesc: string | null
    wordCount: number
    links: string[]
    headings: string[]
    content: string
    summary: string
  }) => any
}): Promise<{ pages: any[]; failures: FetchPageFailure[]; attempted: number }> {
  const visited = new Set<string>()
  const pages: any[] = []
  const failures: FetchPageFailure[] = []
  const queue = uniqueUrls(input.initialQueue)

  while (queue.length > 0 && pages.length < input.maxPages && visited.size < input.maxPages * 6) {
    const batch: string[] = []
    while (queue.length > 0 && batch.length < CRAWL_CONCURRENCY && pages.length + batch.length < input.maxPages) {
      const url = queue.shift()!
      if (visited.has(url)) continue
      visited.add(url)
      batch.push(url)
    }
    if (batch.length === 0) break

    const results = await Promise.all(batch.map(url => fetchPage(url)))
    for (const result of results) {
      if (!result.ok) {
        failures.push(result)
        continue
      }

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

      pages.push(input.buildPage({ html, finalUrl, title, h1, metaDesc, wordCount, links, headings, content, summary }))

      if (!input.usingSitemap) {
        const nextLinks = prioritiseUrls(links, finalUrl, 120)
        for (const link of nextLinks) {
          if (!visited.has(link) && !queue.includes(link)) queue.push(link)
        }
      }
    }
  }

  return { pages, failures, attempted: visited.size }
}

async function insertCompetitorPages(pages: any[], competitorId: string): Promise<string | null> {
  const { error: deleteError } = await supabase.from('competitor_pages').delete().eq('competitor_id', competitorId)
  if (deleteError) throw new Error(`Failed to clear old competitor pages: ${deleteError.message}`)

  const batchSize = 20
  let storageWarning: string | null = null
  for (let i = 0; i < pages.length; i += batchSize) {
    const batch = pages.slice(i, i + batchSize)
    const { error } = await supabase.from('competitor_pages').insert(batch)
    if (!error) continue

    const canFallback = /column .* does not exist|Could not find .* column|schema cache/i.test(error.message)
    if (!canFallback) throw new Error(`Competitor page insert failed at batch ${i / batchSize}: ${error.message}`)

    const legacyBatch = batch.map(({ meta_description, content, headings, internal_links, source, ...page }) => page)
    const { error: legacyError } = await supabase.from('competitor_pages').insert(legacyBatch)
    if (legacyError) throw new Error(`Competitor page insert failed at batch ${i / batchSize}: ${legacyError.message}`)
    storageWarning = 'Competitor pages were stored with legacy fields only. Apply the competitor crawl SQL migration so Ada can retain meta descriptions, headings, internal links, and full page content.'
  }
  return storageWarning
}

export async function POST(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const rate = checkRateLimit({
    key: `crawl:${getRateLimitIdentity(req, authResult.auth.user.id)}`,
    limit: 12,
    windowMs: 10 * 60 * 1000,
  })
  if (!rate.ok) return rate.response

  const budgetCheck = await checkUserBudget(supabase, authResult.auth.user.id)
  if (!budgetCheck.ok && budgetCheck.response) return budgetCheck.response

  const bodyResult = await readJsonWithLimit<any>(req, 20_000)
  if (!bodyResult.ok) return bodyResult.response
  const body = bodyResult.data
  const { client_id, website, competitor_id } = body

  if (!competitor_id && !client_id) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  }
  if (!competitor_id && !website) {
    return NextResponse.json({ error: 'website is required for client crawl' }, { status: 400 })
  }
  if (client_id && !(await userCanAccessClient(supabase, authResult.auth.user.id, client_id))) {
    return forbiddenResponse()
  }

  // Competitor crawl mode
  if (competitor_id) {
    const { data: comp } = await supabase.from('competitor_sites').select('url, name, client_id').eq('id', competitor_id).single()
    if (!comp?.url) return NextResponse.json({ error: 'Competitor site not found or has no URL' }, { status: 400 })
    const competitorClientId = client_id || comp.client_id
    if (!competitorClientId || !(await userCanAccessClient(supabase, authResult.auth.user.id, competitorClientId))) {
      return forbiddenResponse()
    }

    // Resolve workspace_id for competitor pages — same fallback chain as normal crawl
    let compWorkspaceId: string | null = null
    if (competitorClientId) {
      const { data: gcRow2 } = await supabase.from('google_connections').select('workspace_id').eq('client_id', competitorClientId).maybeSingle()
      compWorkspaceId = gcRow2?.workspace_id ?? null
      if (!compWorkspaceId) {
        const { data: cpRow2 } = await supabase.from('client_profiles').select('workspace_id').eq('id', competitorClientId).maybeSingle()
        compWorkspaceId = cpRow2?.workspace_id ?? null
      }
    }
    if (!compWorkspaceId) {
      const { data: wsRow2 } = await supabase.from('workspaces').select('id').limit(1).maybeSingle()
      compWorkspaceId = wsRow2?.id ?? null
    }

    const baseUrl = normaliseBaseUrl(comp.url)
    if (!baseUrl) return NextResponse.json({ error: 'Competitor site URL is invalid.' }, { status: 400 })
    const sitemapDiscovery = await fetchSitemapUrls(baseUrl)
    const sitemapUrls = prioritiseUrls(sitemapDiscovery.urls, baseUrl, COMPETITOR_MAX_PAGES - 1)
    const usingSitemap = sitemapUrls.length > 0
    const queue = usingSitemap ? uniqueUrls([baseUrl, ...sitemapUrls]) : [baseUrl]
    const crawlResult = await crawlPageQueue({
      initialQueue: queue,
      maxPages: COMPETITOR_MAX_PAGES,
      usingSitemap,
      buildPage: ({ finalUrl, title, h1, metaDesc, wordCount, links, headings, content, summary }) => ({
        workspace_id: compWorkspaceId,
        competitor_id,
        client_id: competitorClientId,
        url: finalUrl,
        title,
        h1,
        meta_description: metaDesc,
        word_count: wordCount,
        content,
        content_summary: summary,
        headings,
        internal_links: links.slice(0, 30),
        source: usingSitemap ? 'sitemap' : 'crawl',
        crawled_at: new Date().toISOString(),
      }),
    })
    const pages = crawlResult.pages
    const fetchFailures = [...crawlResult.failures, ...sitemapDiscovery.failures]

    if (pages.length === 0) {
      return NextResponse.json({
        error: 'No competitor pages were crawled.',
        details: noPagesDetails({ attempted: crawlResult.attempted, sitemapUrlCount: sitemapDiscovery.urls.length, usingSitemap, failures: fetchFailures }),
      }, { status: 400 })
    }

    let storageWarning: string | null = null
    try {
      storageWarning = await insertCompetitorPages(pages, competitor_id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to store competitor pages.'
      return NextResponse.json({ error: message }, { status: 500 })
    }
    await supabase.from('competitor_sites').update({ last_crawled_at: new Date().toISOString() }).eq('id', competitor_id)

    // Generate content summaries for competitor pages using Haiku
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (apiKey && pages.length > 0) {
      const pagesToSummarise = pages.slice(0, 20)
      let totalTokensUsed = 0
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
            totalTokensUsed += (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
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
      await recordTokenUsage({
        supabase,
        userId: authResult.auth.user.id,
        workspaceId: compWorkspaceId,
        clientId: competitorClientId,
        action: 'competitor_crawl_summary',
        tokensUsed: totalTokensUsed,
        detail: { model: 'claude-haiku-4-5-20251001', pages_summarised: pagesToSummarise.length, source: 'crawl' },
      })
    }

    return NextResponse.json({
      success: true,
      pages_crawled: pages.length,
      sitemap_pages_found: sitemapDiscovery.urls.length,
      sitemaps_checked: sitemapDiscovery.checked.length,
      storage_warning: storageWarning,
      competitor: comp.name,
    })
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

  const baseUrl = normaliseBaseUrl(website)
  if (!baseUrl) {
    return NextResponse.json({ error: 'Website URL is invalid.' }, { status: 400 })
  }
  const sitemapDiscovery = await fetchSitemapUrls(baseUrl)
  const sitemapUrls = prioritiseUrls(sitemapDiscovery.urls, baseUrl, CLIENT_MAX_PAGES - 1)
  const usingSitemap = sitemapUrls.length > 0
  const queue = usingSitemap ? uniqueUrls([baseUrl, ...sitemapUrls]) : [baseUrl]
  const crawlResult = await crawlPageQueue({
    initialQueue: queue,
    maxPages: CLIENT_MAX_PAGES,
    usingSitemap,
    buildPage: ({ finalUrl, title, h1, metaDesc, wordCount, links, content, summary }) => ({
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
    }),
  })
  const pages = crawlResult.pages
  const fetchFailures = [...crawlResult.failures, ...sitemapDiscovery.failures]

  if (pages.length === 0) {
    return NextResponse.json({
      error: 'Could not crawl site. Check the URL is correct, publicly accessible, and returns HTML within 12 seconds.',
      details: noPagesDetails({ attempted: crawlResult.attempted, sitemapUrlCount: sitemapDiscovery.urls.length, usingSitemap, failures: fetchFailures }),
    }, { status: 400 })
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

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ success: true, pages_crawled: pages.length, workspace_id: workspaceId })

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
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
      const tokensUsed = (aiData.usage?.input_tokens || 0) + (aiData.usage?.output_tokens || 0)
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
      await recordTokenUsage({
        supabase,
        userId: authResult.auth.user.id,
        workspaceId,
        clientId: client_id,
        action: 'crawl_content_summary',
        tokensUsed,
        detail: { model: 'claude-haiku-4-5-20251001', source: 'crawl' },
      })
    }
  } catch { /* non-critical — don't block crawl response */ }

  return NextResponse.json({ success: true, pages_crawled: pages.length, workspace_id: workspaceId })
}
