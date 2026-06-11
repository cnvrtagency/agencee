import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// PATCH — save GitHub config, encrypting the token server-side
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params
  const { github_repo, github_branch, github_token } = await req.json()

  const updates: Record<string, string> = {
    github_repo: github_repo || '',
    github_branch: github_branch || 'main',
  }

  // Only encrypt and save the token if a new one was provided
  if (github_token && github_token.trim()) {
    updates.github_token = encrypt(github_token.trim())
  }

  const { error } = await supabase
    .from('client_profiles')
    .update(updates)
    .eq('id', clientId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
