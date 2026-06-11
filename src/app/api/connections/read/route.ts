import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { forbiddenResponse, requireUser, userCanAccessClient } from '@/lib/server/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const { searchParams } = new URL(req.url)
  const connection_id = searchParams.get('connection_id')
  const resource = searchParams.get('resource') || 'posts' // 'posts' | 'pages' | 'products'
  if (!connection_id) return NextResponse.json({ error: 'Missing connection_id' }, { status: 400 })

  const { data: conn } = await supabase.from('site_connections').select('*').eq('id', connection_id).single()
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  if (!(await userCanAccessClient(supabase, authResult.auth.user.id, conn.client_id))) return forbiddenResponse()

  try {
    switch (conn.platform) {
      case 'wordpress': {
        const { url, username, app_password } = conn.config
        const base = url.replace(/\/$/, '')
        const auth = `Basic ${Buffer.from(`${username}:${app_password}`).toString('base64')}`
        const res = await fetch(`${base}/wp-json/wp/v2/${resource}?per_page=20&orderby=date`, {
          headers: { 'Authorization': auth },
        })
        if (!res.ok) return NextResponse.json({ error: `HTTP ${res.status}` }, { status: 400 })
        const items = await res.json()
        return NextResponse.json({ items: items.map((p: any) => ({
          id: p.id,
          title: p.title?.rendered,
          url: p.link,
          status: p.status,
          date: p.date,
        }))})
      }

      case 'shopify': {
        const { shop, access_token } = conn.config
        const res = await fetch(`https://${shop}/admin/api/2024-01/${resource === 'posts' ? 'articles' : resource}.json?limit=20`, {
          headers: { 'X-Shopify-Access-Token': access_token },
        })
        if (!res.ok) return NextResponse.json({ error: `HTTP ${res.status}` }, { status: 400 })
        const data = await res.json()
        const items = data.articles || data.pages || data.products || []
        return NextResponse.json({ items: items.map((p: any) => ({
          id: p.id,
          title: p.title,
          url: p.url,
          status: p.published_at ? 'published' : 'draft',
          date: p.created_at,
        }))})
      }

      case 'webflow': {
        const { api_token, collection_id } = conn.config
        if (!collection_id) return NextResponse.json({ items: [] })
        const res = await fetch(`https://api.webflow.com/v2/collections/${collection_id}/items?limit=20`, {
          headers: { 'Authorization': `Bearer ${api_token}` },
        })
        if (!res.ok) return NextResponse.json({ error: `HTTP ${res.status}` }, { status: 400 })
        const data = await res.json()
        return NextResponse.json({ items: (data.items || []).map((p: any) => ({
          id: p.id,
          title: p.fieldData?.name,
          url: null,
          status: p.isDraft ? 'draft' : 'published',
          date: p.createdOn,
        }))})
      }

      default:
        return NextResponse.json({ items: [] })
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Read failed' }, { status: 500 })
  }
}
