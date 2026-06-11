import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { safeDecrypt } from '@/lib/crypto'
import { atomicCommit, parseRepoUrl } from '@/lib/github-commit'

export const maxDuration = 120

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

type OutputImage = { url: string; alt_text?: string; filename: string; storage_path?: string }

// GET /api/repair/frontmatter-images?dry_run=true
// POST /api/repair/frontmatter-images   (actually patches GitHub)
//
// Finds all published GitHub content_outputs that have images and checks whether
// the committed MDX is missing a valid image: /assets/... frontmatter field.
// Reports or patches each affected file.

export async function GET(req: NextRequest) {
  return run(req, true)
}

export async function POST(req: NextRequest) {
  return run(req, false)
}

async function run(req: NextRequest, dryRun: boolean) {
  // Fetch all published content_outputs that have images
  const { data: outputs, error } = await supabase
    .from('content_outputs')
    .select('*, client_profiles(*)')
    .not('published_url', 'is', null)
    .not('images', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: {
    output_id: string
    title: string
    slug: string
    status: 'ok' | 'patched' | 'skipped' | 'error'
    reason?: string
  }[] = []

  for (const output of outputs ?? []) {
    const images: OutputImage[] = Array.isArray(output.images) ? output.images : []
    if (!images[0]?.filename) {
      results.push({ output_id: output.id, title: output.title, slug: '', status: 'skipped', reason: 'no images on output' })
      continue
    }

    // Only repair GitHub-published posts
    const platform = output.platform_output?.platform
    if (platform && platform !== 'github') {
      results.push({ output_id: output.id, title: output.title, slug: '', status: 'skipped', reason: `platform=${platform}` })
      continue
    }

    const client = output.client_profiles as any
    const rawToken = client?.github_token
    if (!rawToken) {
      results.push({ output_id: output.id, title: output.title, slug: '', status: 'error', reason: 'no github_token on client' })
      continue
    }
    const token = safeDecrypt(rawToken) || rawToken

    const repoUrl: string | undefined = client?.github_repo
    if (!repoUrl) {
      results.push({ output_id: output.id, title: output.title, slug: '', status: 'error', reason: 'no github_repo on client' })
      continue
    }
    const parsed = parseRepoUrl(repoUrl)
    if (!parsed) {
      results.push({ output_id: output.id, title: output.title, slug: '', status: 'error', reason: `invalid repo URL: ${repoUrl}` })
      continue
    }

    // Derive slug from content frontmatter or keyword/title
    const content: string = output.content || ''
    const slugMatch = content.match(/slug:\s*["']?([a-z0-9-]+)/)
    function slugify(t: string) { return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
    const slug = slugMatch?.[1] || slugify(output.primary_keyword || output.title || output.id)

    const branch = client?.github_branch || 'main'
    const contentPath = 'next-public/content/posts'
    const mdxPath = `${contentPath}/${slug}.mdx`
    const GH = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    }

    // Read the committed MDX
    let committedContent: string
    try {
      const res = await fetch(`${GH}/contents/${mdxPath}?ref=${branch}`, { headers })
      if (!res.ok) {
        results.push({ output_id: output.id, title: output.title, slug, status: 'error', reason: `GitHub read failed (${res.status})` })
        continue
      }
      const { content: b64 } = await res.json()
      committedContent = Buffer.from(b64, 'base64').toString('utf8')
    } catch (e: any) {
      results.push({ output_id: output.id, title: output.title, slug, status: 'error', reason: e.message })
      continue
    }

    // Check if image: /assets/... is already correct
    if (/^image:\s*["']?\/assets\//m.test(committedContent)) {
      results.push({ output_id: output.id, title: output.title, slug, status: 'ok' })
      continue
    }

    // Needs patching
    const heroPath = `/assets/${images[0].filename}`
    const heroAlt = (images[0].alt_text || output.title || '').replace(/"/g, '\\"')
    let patched = committedContent

    // Fix any https:// URL on the image: line
    patched = patched.replace(
      /^(image:\s*["']?)https?:\/\/[^\s"'\n]+(["']?)$/m,
      `$1${heroPath}$2`
    )

    // If still no local path, inject or replace
    if (!/^image:\s*["']?\/assets\//m.test(patched)) {
      if (/^image:/m.test(patched)) {
        patched = patched.replace(/^image:.*$/m, `image: "${heroPath}"`)
      } else if (/^date:/m.test(patched)) {
        patched = patched.replace(/^(date:[^\n]*)/m, `$1\nimage: "${heroPath}"`)
      } else {
        patched = patched.replace(/^(---\n[\s\S]*?)(---)/, `$1image: "${heroPath}"\n$2`)
      }
    }

    // Ensure image_alt:
    if (!/^image_alt:\s*["']?\S/m.test(patched)) {
      if (/^image_alt:/m.test(patched)) {
        patched = patched.replace(/^image_alt:.*$/m, `image_alt: "${heroAlt}"`)
      } else {
        patched = patched.replace(/^(image:[^\n]*)/m, `$1\nimage_alt: "${heroAlt}"`)
      }
    }

    if (dryRun) {
      results.push({ output_id: output.id, title: output.title, slug, status: 'patched', reason: 'dry_run — would patch' })
      continue
    }

    // Commit the patched MDX
    try {
      await atomicCommit({
        owner: parsed.owner,
        repo: parsed.repo,
        branch,
        token,
        files: [{ path: mdxPath, content: patched }],
        message: `fix: inject missing image frontmatter for ${slug}`,
      })
      // Also update platform_output with hero_image_path
      await supabase
        .from('content_outputs')
        .update({
          platform_output: {
            ...(output.platform_output || {}),
            hero_image_path: heroPath,
          },
        })
        .eq('id', output.id)
      results.push({ output_id: output.id, title: output.title, slug, status: 'patched' })
    } catch (e: any) {
      results.push({ output_id: output.id, title: output.title, slug, status: 'error', reason: e.message })
    }
  }

  const summary = {
    total: results.length,
    ok: results.filter(r => r.status === 'ok').length,
    patched: results.filter(r => r.status === 'patched').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: results.filter(r => r.status === 'error').length,
    dry_run: dryRun,
    results,
  }

  return NextResponse.json(summary)
}
