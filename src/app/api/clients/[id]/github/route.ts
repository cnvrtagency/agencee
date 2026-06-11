import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encrypt, safeDecrypt } from '@/lib/crypto'
import { forbiddenResponse, requireUser, userCanAccessClient } from '@/lib/server/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const clean = url.trim().replace(/\.git$/, '').replace(/\/$/, '')
    const match = clean.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  } catch { return null }
}

function githubErrorMessage(status: number, message: string, owner: string, repo: string, branch: string): string {
  if (status === 401) {
    return 'GitHub token was rejected. Generate a fresh token with repo Contents read/write access, then save again.'
  }
  if (status === 404) {
    return `GitHub repo or branch not found, or this token cannot access ${owner}/${repo}@${branch}.`
  }
  if (status === 403) {
    return `GitHub refused access to ${owner}/${repo}@${branch}. Check that the token has Contents read/write access.`
  }
  return message || `GitHub API error ${status}`
}

async function validateGithubAccess(repoUrl: string, branch: string, token: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const parsed = parseRepoUrl(repoUrl)
  if (!parsed) return { ok: false, status: 400, error: 'Invalid GitHub repo URL. Use https://github.com/owner/repo.' }

  const res = await fetch(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { ok: false, status: res.status === 401 ? 401 : 400, error: githubErrorMessage(res.status, err.message, parsed.owner, parsed.repo, branch) }
  }
  return { ok: true }
}

// PATCH — save GitHub config, encrypting the token server-side
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const { id: clientId } = await params
  if (!(await userCanAccessClient(supabase, authResult.auth.user.id, clientId))) return forbiddenResponse()

  const { github_repo, github_branch, github_token } = await req.json()
  const repo = (github_repo || '').trim()
  const branch = (github_branch || 'main').trim() || 'main'
  const newToken = github_token?.trim()

  const { data: current } = await supabase
    .from('client_profiles')
    .select('github_token')
    .eq('id', clientId)
    .maybeSingle()

  const existingToken = current?.github_token ? safeDecrypt(current.github_token) || current.github_token : ''
  const tokenToValidate = newToken || existingToken

  if (repo && tokenToValidate) {
    const validation = await validateGithubAccess(repo, branch, tokenToValidate)
    if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: validation.status })
  } else if (repo && !tokenToValidate) {
    return NextResponse.json({ error: 'GitHub token is required before saving this repository.' }, { status: 400 })
  }

  const updates: Record<string, string> = {
    github_repo: repo,
    github_branch: branch,
  }

  // Only encrypt and save the token if a new one was provided
  if (newToken) {
    try {
      updates.github_token = encrypt(newToken)
    } catch (encryptErr: any) {
      console.error('[github/route] encrypt failed:', encryptErr?.message)
      return NextResponse.json({
        error: 'Token encryption failed. Check that ENCRYPTION_KEY is set correctly in Vercel environment variables. It must be a 32-byte base64 string.',
      }, { status: 500 })
    }
  }

  const { error } = await supabase
    .from('client_profiles')
    .update(updates)
    .eq('id', clientId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
