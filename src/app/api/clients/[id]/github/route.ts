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
    const shorthand = clean.match(/^([^/\s]+)\/([^/\s]+)$/)
    if (shorthand) return { owner: shorthand[1], repo: shorthand[2] }
    const match = clean.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  } catch { return null }
}

type GithubValidation =
  | { ok: true; owner: string; repo: string; branch: string; defaultBranch: string; canonicalRepo: string }
  | { ok: false; status: number; error: string }

function githubErrorMessage(status: number, message: string, owner: string, repo: string, branch?: string): string {
  if (status === 401) {
    return 'GitHub token was rejected. Generate a fresh token with repo Contents read/write access, then save again.'
  }
  if (status === 404) {
    return branch
      ? `GitHub repo or branch not found, or this token cannot access ${owner}/${repo}@${branch}.`
      : `GitHub repo not found, or this token cannot access ${owner}/${repo}.`
  }
  if (status === 403) {
    return `GitHub refused access to ${owner}/${repo}${branch ? `@${branch}` : ''}. Check that the token has Contents read/write access.`
  }
  return message || `GitHub API error ${status}`
}

function similarityScore(requested: string, candidate: string): number {
  const req = requested.toLowerCase()
  const cand = candidate.toLowerCase()
  if (req === cand) return 100
  if (cand.includes(req) || req.includes(cand)) return 80
  const reqParts = new Set(req.split(/[-_\s]+/).filter(Boolean))
  const candParts = new Set(cand.split(/[-_\s]+/).filter(Boolean))
  const overlap = [...reqParts].filter(part => candParts.has(part)).length
  return overlap * 20
}

async function repoSuggestions(token: string, owner: string, repo: string): Promise<string[]> {
  const suggestions: Array<{ fullName: string; score: number; defaultBranch: string }> = []
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
    })
    if (!res.ok) break
    const repos = await res.json()
    if (!Array.isArray(repos) || repos.length === 0) break
    for (const candidate of repos) {
      const score = Math.max(
        similarityScore(repo, candidate.name || ''),
        candidate.owner?.login === owner ? similarityScore(repo, candidate.name || '') + 10 : 0
      )
      if (score >= 40) {
        suggestions.push({
          fullName: candidate.full_name,
          score,
          defaultBranch: candidate.default_branch || 'main',
        })
      }
    }
  }
  return suggestions
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => `${s.fullName} (${s.defaultBranch})`)
}

async function validateGithubAccess(repoUrl: string, branchInput: string, token: string): Promise<GithubValidation> {
  const parsed = parseRepoUrl(repoUrl)
  if (!parsed) return { ok: false, status: 400, error: 'Invalid GitHub repo URL. Use https://github.com/owner/repo or owner/repo.' }

  const repoRes = await fetch(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
  )
  if (!repoRes.ok) {
    const err = await repoRes.json().catch(() => ({}))
    let error = githubErrorMessage(repoRes.status, err.message, parsed.owner, parsed.repo)
    if (repoRes.status === 404) {
      const close = await repoSuggestions(token, parsed.owner, parsed.repo)
      if (close.length > 0) {
        error += ` Accessible close match${close.length === 1 ? '' : 'es'}: ${close.join(', ')}.`
      }
    }
    return { ok: false, status: repoRes.status === 401 ? 401 : 400, error }
  }

  const repoData = await repoRes.json()
  const defaultBranch = repoData.default_branch || 'main'
  const branch = (branchInput || defaultBranch).trim() || defaultBranch

  const treeRes = await fetch(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
  )
  if (!treeRes.ok) {
    const err = await treeRes.json().catch(() => ({}))
    if (treeRes.status === 404 && branch !== defaultBranch) {
      return {
        ok: false,
        status: 400,
        error: `Branch "${branch}" was not found on ${parsed.owner}/${parsed.repo}. The repository default branch is "${defaultBranch}". Leave the branch blank or use "${defaultBranch}".`,
      }
    }
    return { ok: false, status: treeRes.status === 401 ? 401 : 400, error: githubErrorMessage(treeRes.status, err.message, parsed.owner, parsed.repo, branch) }
  }

  return {
    ok: true,
    owner: parsed.owner,
    repo: parsed.repo,
    branch,
    defaultBranch,
    canonicalRepo: `https://github.com/${parsed.owner}/${parsed.repo}.git`,
  }
}

// PATCH — save GitHub config, encrypting the token server-side
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const { id: clientId } = await params
  if (!(await userCanAccessClient(supabase, authResult.auth.user.id, clientId))) return forbiddenResponse()

  const { github_repo, github_branch, github_token } = await req.json()
  const repo = (github_repo || '').trim()
  const branchInput = (github_branch || '').trim()
  const newToken = github_token?.trim()

  const { data: current } = await supabase
    .from('client_profiles')
    .select('github_token')
    .eq('id', clientId)
    .maybeSingle()

  const existingToken = current?.github_token ? safeDecrypt(current.github_token) || current.github_token : ''
  const tokenToValidate = newToken || existingToken

  let validation: GithubValidation | null = null
  if (repo && tokenToValidate) {
    validation = await validateGithubAccess(repo, branchInput, tokenToValidate)
    if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: validation.status })
  } else if (repo && !tokenToValidate) {
    return NextResponse.json({ error: 'GitHub token is required before saving this repository.' }, { status: 400 })
  }

  const updates: Record<string, string> = {
    github_repo: validation?.ok ? validation.canonicalRepo : repo,
    github_branch: validation?.ok ? validation.branch : (branchInput || 'main'),
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
  return NextResponse.json({
    ok: true,
    github_repo: updates.github_repo,
    github_branch: updates.github_branch,
    default_branch: validation?.ok ? validation.defaultBranch : undefined,
  })
}
