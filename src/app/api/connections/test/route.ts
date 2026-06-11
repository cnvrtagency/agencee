import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  const { connection_id } = await req.json()
  if (!connection_id) return NextResponse.json({ error: 'Missing connection_id' }, { status: 400 })

  const { data: conn } = await supabase.from('site_connections').select('*').eq('id', connection_id).single()
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  let ok = false
  let message = ''

  try {
    switch (conn.platform) {
      case 'wordpress': {
        const { url, username, app_password } = conn.config
        if (!url || !username || !app_password) { message = 'Missing URL, username, or app password'; break }
        const base = url.replace(/\/$/, '')
        const res = await fetch(`${base}/wp-json/wp/v2/posts?per_page=1`, {
          headers: { 'Authorization': `Basic ${Buffer.from(`${username}:${app_password}`).toString('base64')}` },
        })
        ok = res.ok
        message = ok ? 'WordPress REST API is reachable and credentials are valid.' : `HTTP ${res.status}`
        break
      }
      case 'shopify': {
        const { shop, access_token } = conn.config
        if (!shop || !access_token) { message = 'Missing shop domain or access token'; break }
        const res = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
          headers: { 'X-Shopify-Access-Token': access_token },
        })
        ok = res.ok
        message = ok ? 'Shopify store is reachable and token is valid.' : `HTTP ${res.status}`
        break
      }
      case 'webflow': {
        const { api_token } = conn.config
        if (!api_token) { message = 'Missing API token'; break }
        const res = await fetch('https://api.webflow.com/v2/sites', {
          headers: { 'Authorization': `Bearer ${api_token}`, 'accept-version': '1.0.0' },
        })
        ok = res.ok
        message = ok ? 'Webflow API is reachable and token is valid.' : `HTTP ${res.status}`
        break
      }
      case 'github': {
        const { data: cp } = await supabase
          .from('client_profiles')
          .select('github_repo, github_token')
          .eq('id', conn.client_id)
          .maybeSingle()

        const repo = conn.config?.repo || cp?.github_repo
        if (!repo) { message = 'No GitHub repo configured. Add one in the Codebase tab.'; break }

        const match = repo.match(/github\.com\/([^/]+\/[^/]+)/)
        if (!match) { message = 'Invalid GitHub repo URL format'; break }

        let token: string | null = conn.config?.token || null
        if (!token && cp?.github_token) {
          try {
            const { safeDecrypt } = await import('@/lib/crypto')
            token = safeDecrypt(cp.github_token) || null
          } catch { token = null }
        }

        const res = await fetch(`https://api.github.com/repos/${match[1]}`, {
          headers: {
            ...(token ? { 'Authorization': `token ${token}` } : {}),
            'Accept': 'application/vnd.github.v3+json',
          },
        })
        ok = res.ok
        message = ok ? `GitHub repo accessible: ${match[1]}` : `HTTP ${res.status} -- check repo URL and token in Codebase tab`
        break
      }
      default:
        message = 'Unknown platform'
    }
  } catch (e: any) {
    message = e.message || 'Connection test failed'
  }

  // Update last_tested_at and status
  await supabase.from('site_connections').update({
    status: ok ? 'connected' : 'error',
    last_tested_at: new Date().toISOString(),
  }).eq('id', connection_id)

  return NextResponse.json({ ok, message })
}
