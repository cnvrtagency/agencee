import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  const { output_id } = await req.json()

  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  const teamId = process.env.VERCEL_TEAM_ID

  if (!token || !projectId) {
    return NextResponse.json({ error: 'Vercel not configured — VERCEL_TOKEN and VERCEL_PROJECT_ID required' }, { status: 500 })
  }

  const teamParam = teamId ? `&teamId=${teamId}` : ''

  // Fetch the most recent ready deployments — no target filter so we catch both
  // preview (needs promoting) and production (already live from a main-branch commit)
  const deploymentsRes = await fetch(
    `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=10${teamParam}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const deploymentsData = await deploymentsRes.json()

  const latestDeployment = deploymentsData.deployments?.find(
    (d: any) => d.state === 'READY' || d.readyState === 'READY'
  )

  if (!latestDeployment) {
    return NextResponse.json({ error: 'No ready deployment found — Vercel may still be building. Try again in a moment.' }, { status: 404 })
  }

  // If the latest ready deployment is already on production (main-branch auto-deploy),
  // there is nothing to promote — the content is already live.
  const isAlreadyProduction = latestDeployment.target === 'production'

  if (!isAlreadyProduction) {
    // Promote preview → production
    const promoteRes = await fetch(
      `https://api.vercel.com/v13/deployments/${latestDeployment.uid}/promote${teamId ? `?teamId=${teamId}` : ''}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: projectId }),
      }
    )

    if (!promoteRes.ok) {
      const err = await promoteRes.json()
      return NextResponse.json({ error: err.error?.message || 'Promotion failed' }, { status: 400 })
    }
  }

  // Update content_outputs — derive published URL from client's website + post slug
  if (output_id) {
    const { data: outputRow } = await supabase
      .from('content_outputs')
      .select('client_id, primary_keyword, title')
      .eq('id', output_id)
      .single()

    let publishedUrl = latestDeployment.url ? `https://${latestDeployment.url}` : ''
    if (outputRow?.client_id) {
      const { data: clientRow } = await supabase
        .from('client_profiles')
        .select('website')
        .eq('id', outputRow.client_id)
        .single()
      if (clientRow?.website) {
        const base = clientRow.website.replace(/\/$/, '')
        // Build the blog post slug from primary_keyword (kebab-case)
        const slug = (outputRow.primary_keyword || outputRow.title || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
        publishedUrl = slug ? `${base}/blog/${slug}` : base
      }
    }

    await supabase
      .from('content_outputs')
      .update({ published_url: publishedUrl, approved: true })
      .eq('id', output_id)
  }

  return NextResponse.json({
    success: true,
    deployment_id: latestDeployment.uid,
    url: latestDeployment.url,
  })
}
