import { NextRequest, NextResponse } from 'next/server'
import { forbiddenResponse, getSupabaseAdmin, requireUser } from '@/lib/server/auth'

const supabase = getSupabaseAdmin()

async function userCanAccessAgent(userId: string, agentId: string): Promise<boolean> {
  const { data: agent } = await supabase
    .from('agents')
    .select('id,user_id,workspace_id')
    .eq('id', agentId)
    .maybeSingle()

  if (!agent) return false
  if (agent.user_id === userId) return true
  if (!agent.workspace_id) return false

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('id', agent.workspace_id)
    .eq('owner_id', userId)
    .maybeSingle()

  return !!workspace
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const { id } = await params
  const { data: conversation, error: loadError } = await supabase
    .from('conversations')
    .select('id,agent_id')
    .eq('id', id)
    .maybeSingle()

  if (loadError) {
    return NextResponse.json({ success: false, error: loadError.message }, { status: 500 })
  }
  if (!conversation) {
    return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 })
  }
  if (!(await userCanAccessAgent(authResult.auth.user.id, conversation.agent_id))) return forbiddenResponse()

  const { error: messagesError } = await supabase
    .from('messages')
    .delete()
    .eq('conversation_id', id)

  if (messagesError) {
    return NextResponse.json({ success: false, error: messagesError.message }, { status: 500 })
  }

  const { error: conversationError } = await supabase
    .from('conversations')
    .delete()
    .eq('id', id)

  if (conversationError) {
    return NextResponse.json({ success: false, error: conversationError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
