import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { marked } from 'marked'
import { safeDecrypt } from '@/lib/crypto'
import { atomicCommit, parseRepoUrl, type CommitFile } from '@/lib/github-commit'

export const maxDuration = 120

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

type OutputImage = { url: string; alt_text?: string; filename: string; storage_path?: string }

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '')
}

async function markdownToHtml(markdown: string): Promise<string> {
  return marked.parse(stripFrontmatter(markdown))
}

async function logFailure(output_id: string, error: string) {
  try {
    await supabase.from('agent_activity').insert({
      action: 'publish_failed',
      detail: { output_id, error },
    })
  } catch (e: any) {
    console.error('[publish] Failed to log publish_failed activity:', e.message)
  }
}

function fail(status: number, error: string, output_id?: string) {
  console.error('[publish] Failed:', { output_id, error })
  if (output_id) void logFailure(output_id, error)
  return NextResponse.json({ success: false, error }, { status })
}

export async function POST(req: NextRequest) {
  let output_id: string | undefined
  try {
    const body = await req.json()
    output_id = body.output_id
    const connection_id: string | undefined = body.connection_id
    if (!output_id) {
      return NextResponse.json({ success: false, error: 'output_id required' }, { status: 400 })
    }

    // 1. Load output with client
    const { data: output } = await supabase
      .from('content_outputs')
      .select('*, client_profiles(*)')
      .eq('id', output_id)
      .single()
    if (!output) return fail(404, 'Output not found')

    // 2. Idempotent: never publish twice
    if (output.published_url) {
      return NextResponse.json({
        success: true,
        published_url: output.published_url,
        platform: output.platform_output?.platform || 'unknown',
        already_published: true,
      })
    }

    const client = output.client_profiles as any

    // 3. Load connection
    let connection: any = null
    if (connection_id) {
      const { data } = await supabase.from('site_connections').select('*').eq('id', connection_id).single()
      connection = data
    } else if (output.client_id) {
      const { data } = await supabase
        .from('site_connections')
        .select('*')
        .eq('client_id', output.client_id)
        .limit(1)
      connection = data?.[0] || null
    }
    if (!connection) {
      return fail(400, 'No site connection configured for this client. Add one in the client Connections tab.', output_id)
    }

    // 4. Slug from frontmatter, falling back to keyword/title
    const content: string = output.content || ''
    const slugMatch = content.match(/slug:\s*["']?([a-z0-9-]+)/)
    const slug = slugMatch?.[1] || slugify(output.primary_keyword || output.title || output_id)

    const images: OutputImage[] = Array.isArray(output.images) ? output.images : []
    const config = connection.config || {}

    let published_url: string
    let publish_id: string
    const platform: string = connection.platform

    // 5. Platform dispatch
    if (platform === 'github') {
      // Token lives on the client profile, possibly encrypted
      const rawToken = client?.github_token
      if (!rawToken) {
        return fail(400, 'No GitHub token on this client. Reconnect the repo in Connections.', output_id)
      }
      const token = safeDecrypt(rawToken) || rawToken

      const repoUrl: string | undefined = config.repo || client?.github_repo
      if (!repoUrl) return fail(400, 'No GitHub repo configured for this client.', output_id)
      const parsed = parseRepoUrl(repoUrl)
      if (!parsed) return fail(400, `Invalid GitHub repo URL: ${repoUrl}`, output_id)
      const branch: string = config.branch || client?.github_branch || 'main'

      let publishContent = content
      if (!publishContent.trimStart().startsWith('---')) {
        const heroImage = images[0]
        const fm = [
          '---',
          `title: "${(output.title || output.primary_keyword || slug).replace(/"/g, '\\"')}"`,
          `slug: "${slug}"`,
          `description: "${(output.meta_description || '').replace(/"/g, '\\"')}"`,
          `category: "${(output.category || 'Hearing').replace(/"/g, '\\"')}"`,
          `reading_time: "${(output.reading_time || '5 min read').replace(/"/g, '\\"')}"`,
          `date: "${new Date().toISOString().slice(0, 10)}"`,
          `image: "${heroImage ? `/assets/${heroImage.filename}` : ''}"`,
          `image_alt: "${(heroImage?.alt_text || output.title || '').replace(/"/g, '\\"')}"`,
          '---',
          '',
        ].join('\n')
        publishContent = fm + publishContent
      }

      // Download every image from Supabase Storage; fail hard on any miss
      const assetsPath: string = config.assets_path || 'next-public/public/assets'
      const imageFiles: CommitFile[] = []
      for (const img of images) {
        if (!img?.url || !img?.filename) continue
        const res = await fetch(img.url)
        if (!res.ok) {
          return fail(502, `Image download failed for ${img.filename} (${res.status}). Publish aborted — nothing was committed.`, output_id)
        }
        const base64 = Buffer.from(await res.arrayBuffer()).toString('base64')
        imageFiles.push({ path: `${assetsPath}/${img.filename}`, content: base64, encoding: 'base64' })
        // Rewrite Supabase URLs to local asset paths
        publishContent = publishContent.split(img.url).join(`/assets/${img.filename}`)
      }

      // Ensure frontmatter has correct image: and image_alt: fields.
      // Handles four failure modes: URL mismatch, empty value, wrong URL, missing field.
      if (images[0]?.filename) {
        const heroPath = `/assets/${images[0].filename}`
        const heroAlt = (images[0].alt_text || output.title || '').replace(/"/g, '\\"')

        // 1. Replace any remaining https:// value on the image: line (URL mismatch from split/join above)
        publishContent = publishContent.replace(
          /^(image:\s*["']?)https?:\/\/[^\s"'\n]+(["']?)$/m,
          `$1${heroPath}$2`
        )

        // 2. If image: still doesn't resolve to a local /assets/ path, fix or inject it
        if (!/^image:\s*["']?\/assets\//m.test(publishContent)) {
          if (/^image:/m.test(publishContent)) {
            // Field exists but is empty or still wrong — replace the whole line
            publishContent = publishContent.replace(/^image:.*$/m, `image: "${heroPath}"`)
          } else if (/^date:/m.test(publishContent)) {
            // Field is missing — inject after the date: line
            publishContent = publishContent.replace(/^(date:[^\n]*)/m, `$1\nimage: "${heroPath}"`)
          } else {
            // No date: anchor — inject before the closing --- of the frontmatter block
            publishContent = publishContent.replace(/^(---\n[\s\S]*?)(---)/, `$1image: "${heroPath}"\n$2`)
          }
        }

        // 3. Ensure image_alt: is present and non-empty
        if (!/^image_alt:\s*["']?\S/m.test(publishContent)) {
          if (/^image_alt:/m.test(publishContent)) {
            publishContent = publishContent.replace(/^image_alt:.*$/m, `image_alt: "${heroAlt}"`)
          } else {
            // Inject on the line immediately after image:
            publishContent = publishContent.replace(/^(image:[^\n]*)/m, `$1\nimage_alt: "${heroAlt}"`)
          }
        }
      }

      const contentPath: string = config.content_path || 'next-public/content/posts'
      const mdxPath = `${contentPath}/${slug}.mdx`
      const files: CommitFile[] = [{ path: mdxPath, content: publishContent }, ...imageFiles]

      let commit_sha: string
      try {
        const result = await atomicCommit({
          owner: parsed.owner,
          repo: parsed.repo,
          branch,
          token,
          files,
          message: `blog: add ${slug}`,
        })
        commit_sha = result.commit_sha
      } catch (e: any) {
        const msg: string = e.message || 'GitHub commit failed'
        if (msg.includes('(401)') || msg.includes('Bad credentials')) {
          return fail(401, 'GitHub token rejected (401). Reconnect the repo in Connections.', output_id)
        }
        return fail(502, `GitHub commit failed: ${msg}`, output_id)
      }

      const site = (client?.website || '').replace(/\/$/, '')
      published_url = `${site}/blog/${slug}`
      publish_id = commit_sha
    } else if (platform === 'wordpress') {
      const { url, username, app_password } = config
      if (!url || !username || !app_password) {
        return fail(400, 'WordPress connection is missing url, username or app password.', output_id)
      }
      const base = String(url).replace(/\/$/, '')
      const auth = `Basic ${Buffer.from(`${username}:${app_password}`).toString('base64')}`

      let html = await markdownToHtml(content)

      // Sideload images to the WP media library, swap in WP-hosted URLs
      for (const img of images) {
        if (!img?.url || !img?.filename) continue
        const imgRes = await fetch(img.url)
        if (!imgRes.ok) {
          return fail(502, `Image download failed for ${img.filename} (${imgRes.status}). Publish aborted.`, output_id)
        }
        const buffer = Buffer.from(await imgRes.arrayBuffer())
        const contentType = imgRes.headers.get('content-type') || 'image/webp'
        const mediaRes = await fetch(`${base}/wp-json/wp/v2/media`, {
          method: 'POST',
          headers: {
            Authorization: auth,
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${img.filename}"`,
          },
          body: buffer,
        })
        if (!mediaRes.ok) {
          return fail(502, `WordPress media upload failed for ${img.filename} (${mediaRes.status}).`, output_id)
        }
        const media = await mediaRes.json()
        if (media.source_url) html = html.split(img.url).join(media.source_url)
      }

      const postRes = await fetch(`${base}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: output.title || output.primary_keyword || 'New post',
          content: html,
          excerpt: output.meta_description || '',
          status: 'draft',
          slug,
        }),
      })
      if (!postRes.ok) {
        const err = await postRes.json().catch(() => ({}))
        return fail(502, `WordPress post creation failed (${postRes.status}): ${err.message || 'unknown error'}`, output_id)
      }
      const post = await postRes.json()
      published_url = post.link
      publish_id = String(post.id)
    } else if (platform === 'shopify') {
      const { shop, access_token, blog_id } = config
      if (!shop || !access_token) {
        return fail(400, 'Shopify connection is missing shop domain or access token.', output_id)
      }
      const html = await markdownToHtml(content) // Supabase URLs stay inline — Shopify can hotlink

      let blogId = blog_id
      if (!blogId) {
        const blogsRes = await fetch(`https://${shop}/admin/api/2024-01/blogs.json`, {
          headers: { 'X-Shopify-Access-Token': access_token },
        })
        if (!blogsRes.ok) {
          return fail(502, `Could not list Shopify blogs (${blogsRes.status}). Check the access token.`, output_id)
        }
        const blogs = await blogsRes.json()
        blogId = blogs.blogs?.[0]?.id
        if (!blogId) return fail(400, 'No blog found on this Shopify store.', output_id)
      }

      const articleRes = await fetch(`https://${shop}/admin/api/2024-01/blogs/${blogId}/articles.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article: {
            title: output.title || output.primary_keyword || 'New post',
            body_html: html,
            summary_html: output.meta_description || '',
            handle: slug,
            published: false,
          },
        }),
      })
      if (!articleRes.ok) {
        const err = await articleRes.json().catch(() => ({}))
        return fail(502, `Shopify article creation failed (${articleRes.status}): ${JSON.stringify(err.errors || err)}`, output_id)
      }
      const { article } = await articleRes.json()
      published_url = `https://${shop}/blogs/news/${article.handle || slug}`
      publish_id = String(article.id)
    } else if (platform === 'webflow') {
      return fail(501, 'Webflow publishing is not implemented yet.', output_id)
    } else {
      return fail(400, `Publishing to '${platform}' is not supported.`, output_id)
    }

    // 6. Record success
    const heroImagePath = images[0]?.filename ? `/assets/${images[0].filename}` : undefined
    await supabase
      .from('content_outputs')
      .update({
        published_url,
        platform_output: {
          platform,
          publish_id,
          committed_at: new Date().toISOString(),
          ...(heroImagePath && { hero_image_path: heroImagePath }),
        },
      })
      .eq('id', output_id)

    return NextResponse.json({ success: true, published_url, platform })
  } catch (err: any) {
    return fail(500, err.message || 'Publish failed', output_id)
  }
}
