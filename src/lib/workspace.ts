import { supabase } from './supabase'

/** Returns the workspace ID for the currently authenticated user, or null. */
export async function getWorkspaceId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_id', user.id)
    .single()

  return data?.id ?? null
}

/**
 * Returns the workspace ID for the current user.
 * If no workspace exists, creates one with a default Ada agent and workspace settings.
 * Throws if the user is not authenticated.
 */
export async function getOrCreateWorkspace(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: existing } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle()

  if (existing) return existing.id

  // Create workspace for new user
  const { data: created, error } = await supabase
    .from('workspaces')
    .insert({ owner_id: user.id, name: 'My Workspace' })
    .select('id')
    .single()

  if (error || !created) throw new Error('Failed to create workspace')

  // Seed default Ada agent
  await supabase.from('agents').insert({
    workspace_id: created.id,
    name: 'Ada',
    role: 'SEO Specialist',
    slug: 'seo',
    avatar_initials: 'AD',
    description: 'Manages SEO strategy, content production and keyword planning across all clients.',
    agent_type: 'seo',
    active: true,
    instructions: 'You are Ada, an expert SEO strategist and content specialist. You help grow organic traffic for your clients through strategic content production, keyword research, and technical SEO guidance.',
    nav_items: [
      { label: 'Chat', path: '/agents/[id]', icon: 'chat' },
      { label: 'Queue', path: '/agents/[id]/queue', icon: 'list' },
      { label: 'Calendar', path: '/agents/[id]/calendar', icon: 'calendar' },
      { label: 'Keywords', path: '/agents/[id]/keywords', icon: 'tag' },
      { label: 'Outputs', path: '/agents/[id]/outputs', icon: 'file' },
      { label: 'Activity', path: '/agents/[id]/activity', icon: 'activity' },
    ],
  })

  // Seed default workspace settings
  await supabase.from('workspace_settings').upsert({
    workspace_id: created.id,
    user_id: user.id,
    tokens_used_this_month: 0,
    monthly_token_budget: 500000,
    onboarding_completed: false,
  })

  // Seed notification preferences for new workspace
  await supabase.from('notification_preferences').upsert({
    workspace_id: created.id,
    email_enabled: true,
    notify_output_ready: true,
    notify_ranking_changes: true,
    notify_schedule_complete: true,
    notify_schedule_failed: true,
    notify_keyword_suggestions: true,
    digest_time: 8,
  }, { onConflict: 'workspace_id', ignoreDuplicates: true })

  return created.id
}

/** Returns workspace name for the current user. */
export async function getWorkspaceName(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'My Workspace'

  const { data } = await supabase
    .from('workspaces')
    .select('name')
    .eq('owner_id', user.id)
    .maybeSingle()

  return data?.name ?? 'My Workspace'
}
