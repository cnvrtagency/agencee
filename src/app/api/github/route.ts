import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { safeDecrypt } from '@/lib/crypto'
import { atomicCommit, type CommitFile } from '@/lib/github-commit'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function fetchTree(owner: string, repo: string, branch: string, token: string): Promise<any[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
  )
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.message || `GitHub API error ${res.status}`)
  }
  const data = await res.json()
  return data.tree || []
}

function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const clean = url.replace(/\.git$/, '').replace(/\/$/, '')
    const match = clean.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  } catch { return null }
}

function formatTree(files: any[]): string {
  const relevant = files.filter(f => {
    if (f.type !== 'blob') return false
    const p = f.path
    return (
      p.match(/\.(tsx?|jsx?|mdx?|md)$/) ||
      p.match(/^(pages|app|src|content|posts|blog)\//) ||
      p === 'next.config.js' || p === 'next.config.ts' || p === 'package.json'
    )
  })
  const tree: Record<string, string[]> = {}
  for (const f of relevant) {
    const parts = f.path.split('/')
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.'
    if (!tree[dir]) tree[dir] = []
    tree[dir].push(parts[parts.length - 1])
  }
  const lines: string[] = []
  for (const dir of Object.keys(tree).sort()) {
    if (dir !== '.') lines.push(`${dir}/`)
    for (const file of tree[dir].sort()) {
      lines.push(dir === '.' ? `  ${file}` : `  ${dir}/${file}`)
    }
  }
  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  try {
    const { client_id } = await req.json()
    if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

    const { data: client, error: clientError } = await supabase
      .from('client_profiles')
      .select('github_repo, github_branch, github_token')
      .eq('id', client_id)
      .single()

    if (clientError || !client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    if (!client.github_repo) return NextResponse.json({ error: 'No GitHub repo set on this client.' }, { status: 400 })
    if (!client.github_token) return NextResponse.json({ error: 'No GitHub token set on this client.' }, { status: 400 })

    const parsed = parseRepoUrl(client.github_repo)
    if (!parsed) return NextResponse.json({ error: 'Invalid GitHub repo URL.' }, { status: 400 })

    const branch = client.github_branch || 'main'
    const token = safeDecrypt(client.github_token) || client.github_token
    const tree = await fetchTree(parsed.owner, parsed.repo, branch, token)
    const formatted = formatTree(tree)
    const totalFiles = tree.filter(f => f.type === 'blob').length

    await supabase.from('client_profiles').update({
      file_tree: formatted,
      github_synced_at: new Date().toISOString(),
    }).eq('id', client_id)

    return NextResponse.json({ success: true, total_files: totalFiles, tree: formatted })
  } catch (err: any) {
    console.error('github route error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { client_id, path, content, message } = await req.json()
    if (!client_id || !path || !content) return NextResponse.json({ error: 'client_id, path and content required' }, { status: 400 })

    const { data: client } = await supabase
      .from('client_profiles')
      .select('github_repo, github_branch, github_token')
      .eq('id', client_id)
      .single()

    if (!client?.github_repo || !client?.github_token) return NextResponse.json({ error: 'GitHub not configured' }, { status: 400 })

    const parsed = parseRepoUrl(client.github_repo)
    if (!parsed) return NextResponse.json({ error: 'Invalid repo URL' }, { status: 400 })

    const branch = client.github_branch || 'main'
    const token = safeDecrypt(client.github_token) || client.github_token

    const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${path}`

    // Check if file already exists (need its SHA to update)
    let sha: string | undefined
    const existingRes = await fetch(`${apiUrl}?ref=${branch}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
    })
    if (existingRes.ok) {
      const existing = await existingRes.json()
      sha = existing.sha
    }

    const body: Record<string, string> = {
      message: message || `Add ${path}`,
      content: Buffer.from(content).toString('base64'),
      branch,
    }
    if (sha) body.sha = sha

    const res = await fetch(apiUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.message || `GitHub API error ${res.status}`)
    }
    const data = await res.json()
    const fileUrl = data.content?.html_url || `https://github.com/${parsed.owner}/${parsed.repo}/blob/${branch}/${path}`
    return NextResponse.json({ success: true, url: fileUrl, sha: data.content?.sha })
  } catch (err: any) {
    console.error('github PUT error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Atomic multi-file commit via Git Trees API
export async function PATCH(req: NextRequest) {
  let client_id: string | undefined
  let files: CommitFile[] | undefined
  try {
    const body = await req.json()
    client_id = body.client_id
    files = body.files
    const message: string | undefined = body.message
    if (!client_id || !Array.isArray(files) || !files.length) {
      return NextResponse.json({ error: 'client_id and files[] required' }, { status: 400 })
    }

    const { data: client } = await supabase
      .from('client_profiles')
      .select('github_repo, github_branch, github_token')
      .eq('id', client_id)
      .single()

    if (!client?.github_repo || !client?.github_token) {
      return NextResponse.json({ error: 'GitHub not configured' }, { status: 400 })
    }

    const parsed = parseRepoUrl(client.github_repo)
    if (!parsed) return NextResponse.json({ error: 'Invalid repo URL' }, { status: 400 })

    const branch = client.github_branch || 'main'
    const token = safeDecrypt(client.github_token) || client.github_token

    const commitMsg = message || `Update ${files.map((f) => f.path.split('/').pop()).join(', ')}`
    const { commit_sha } = await atomicCommit({
      owner: parsed.owner,
      repo: parsed.repo,
      branch,
      token,
      files,
      message: commitMsg,
    })

    return NextResponse.json({ success: true, commit_sha, files_committed: files.length })
  } catch (err: any) {
    console.error('[github PATCH] Failed:', {
      error: err.message,
      client_id,
      fileCount: files?.length ?? 0,
    })
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const client_id = searchParams.get('client_id')
    const path = searchParams.get('path')
    if (!client_id || !path) return NextResponse.json({ error: 'client_id and path required' }, { status: 400 })

    const { data: client } = await supabase
      .from('client_profiles')
      .select('github_repo, github_branch, github_token')
      .eq('id', client_id)
      .single()

    if (!client?.github_repo || !client?.github_token) return NextResponse.json({ error: 'GitHub not configured' }, { status: 400 })

    const parsed = parseRepoUrl(client.github_repo)
    if (!parsed) return NextResponse.json({ error: 'Invalid repo URL' }, { status: 400 })

    const branch = client.github_branch || 'main'
    const token = safeDecrypt(client.github_token) || client.github_token
    const res = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${path}?ref=${branch}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
    )
    if (!res.ok) return NextResponse.json({ error: `File not found: ${path}` }, { status: 404 })
    const data = await res.json()
    const content = Buffer.from(data.content, 'base64').toString('utf-8')
    return NextResponse.json({ success: true, path, content })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}