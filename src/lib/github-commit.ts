// Shared atomic GitHub commit helper using the Git Trees API.
// IMPORTANT: blob content is ALWAYS sent base64-encoded. Sending raw text with
// encoding 'utf-8' corrupted commits in the past — never do that again.

export type CommitFile = { path: string; content: string; encoding?: 'utf-8' | 'base64' }

export async function atomicCommit(opts: {
  owner: string
  repo: string
  branch: string
  token: string
  files: CommitFile[]
  message: string
}): Promise<{ commit_sha: string }> {
  const { owner, repo, branch, token, files, message } = opts
  const GH = `https://api.github.com/repos/${owner}/${repo}`
  const h = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  }

  const ghError = async (res: Response, fallback: string): Promise<string> => {
    try {
      const e = await res.json()
      return e.message ? `${fallback}: ${e.message} (${res.status})` : `${fallback} (${res.status})`
    } catch {
      return `${fallback} (${res.status})`
    }
  }

  // 1. Get HEAD commit SHA for the branch
  const refRes = await fetch(`${GH}/git/ref/heads/${branch}`, { headers: h })
  if (!refRes.ok) throw new Error(await ghError(refRes, `Failed to get ref for branch '${branch}'`))
  const headSha: string = (await refRes.json()).object.sha

  // 2. Get base tree SHA
  const commitRes = await fetch(`${GH}/git/commits/${headSha}`, { headers: h })
  if (!commitRes.ok) throw new Error(await ghError(commitRes, 'Failed to get base commit'))
  const baseTreeSha: string = (await commitRes.json()).tree.sha

  // 3. Create blobs — content is always base64 on the wire
  const treeItems = await Promise.all(
    files.map(async (f) => {
      const base64Content =
        f.encoding === 'base64' ? f.content : Buffer.from(f.content, 'utf8').toString('base64')
      const blobRes = await fetch(`${GH}/git/blobs`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ content: base64Content, encoding: 'base64' }),
      })
      if (!blobRes.ok) throw new Error(await ghError(blobRes, `Failed to create blob for ${f.path}`))
      const blob = await blobRes.json()
      return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha }
    })
  )

  // 4. Create tree
  const treeRes = await fetch(`${GH}/git/trees`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  })
  if (!treeRes.ok) throw new Error(await ghError(treeRes, 'Failed to create tree'))
  const newTree = await treeRes.json()

  // 5. Create commit
  const newCommitRes = await fetch(`${GH}/git/commits`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }),
  })
  if (!newCommitRes.ok) throw new Error(await ghError(newCommitRes, 'Failed to create commit'))
  const newCommit = await newCommitRes.json()

  // 6. Move branch ref
  const updateRes = await fetch(`${GH}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers: h,
    body: JSON.stringify({ sha: newCommit.sha }),
  })
  if (!updateRes.ok) throw new Error(await ghError(updateRes, `Failed to update ref for branch '${branch}'`))

  return { commit_sha: newCommit.sha }
}

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const clean = url.replace(/\.git$/, '').replace(/\/$/, '')
    const match = clean.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  } catch {
    return null
  }
}
