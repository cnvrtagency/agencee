export type Client = {
  id: string
  name: string
  slug: string
  industry: string | null
  website: string | null
  description: string | null
  icp: string | null
  usp: string | null
  competitors: string[] | null
  brand_voice: string | null
  content_goals: string | null
  top_performing_content: string | null
  created_at: string
  updated_at: string
}

export type Keyword = {
  id: string
  client_id: string
  keyword: string
  cluster: string | null
  intent: 'informational' | 'navigational' | 'commercial' | 'transactional' | null
  funnel_stage: 'tofu' | 'mofu' | 'bofu' | null
  monthly_volume: number | null
  difficulty: number | null
  current_position: number | null
  content_targeting_this: string | null
  priority: number
  created_at: string
}

export type QueueItem = {
  id: string
  client_id: string
  agent_type: string
  content_type: string
  primary_keyword: string
  supporting_keywords: string[] | null
  title_brief: string | null
  word_count: number
  scheduled_for: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'review'
  output_id: string | null
  error: string | null
  created_at: string
  client_profiles?: Client
}

export type OutputImage = {
  url: string
  alt_text?: string
  filename?: string
  storage_path?: string
}

export type Output = {
  id: string
  client_id: string
  queue_item_id: string | null
  agent_type: string
  title: string | null
  content: string
  primary_keyword: string | null
  meta_description: string | null
  word_count: number | null
  approved: boolean
  published_url: string | null
  notes: string | null
  current_version: number | null
  source: string | null
  images?: OutputImage[]
  platform_output?: { platform?: string; publish_id?: string; committed_at?: string } | null
  format?: string | null
  scheduled_publish_at?: string | null
  last_edited_at?: string | null
  created_at: string
  client_profiles?: Client
}

export type ContentHistory = {
  id: string
  client_id: string
  title: string
  url: string | null
  primary_keyword: string | null
  summary: string | null
  published_at: string | null
  performance_notes: string | null
  ranking_position: number | null
  ranking_date: string | null
  traffic_notes: string | null
  created_at: string
}

export type SiteConnection = {
  id: string
  client_id: string
  platform: 'github' | 'wordpress' | 'shopify' | 'webflow'
  label: string | null
  config: Record<string, any>
  status: 'connected' | 'error' | 'disconnected'
  last_tested_at: string | null
  created_at: string
}

export type KeywordSuggestion = {
  id: string
  client_id: string
  keyword: string
  rationale: string | null
  monthly_volume_estimate: number | null
  difficulty_estimate: number | null
  intent: string | null
  funnel_stage: string | null
  cluster: string | null
  status: 'pending' | 'approved' | 'rejected'
  suggested_by: string | null
  created_at: string
}

export type ContentCalendarEntry = {
  id: string
  client_id: string
  title: string
  primary_keyword: string | null
  content_type: string | null
  scheduled_date: string | null
  status: 'planned' | 'in_progress' | 'published' | 'cancelled'
  notes: string | null
  output_id: string | null
  queue_item_id: string | null
  created_at: string
}

export type ClientSchedule = {
  id: string
  client_id: string
  agent_id: string
  enabled: boolean
  cadence: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  content_types: string[]
  target_word_count: number
  notes: string | null
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

export type OutputVersion = {
  id: string
  output_id: string
  version_number: number
  content: string
  title: string | null
  meta_description: string | null
  word_count: number | null
  edited_by: 'human' | 'ada' | 'system'
  created_at: string
}

export type AgentActivity = {
  id: string
  agent_id: string | null
  client_id: string | null
  action: string
  detail: string | null
  tokens_used: number
  created_at: string
}

export type CompetitorSite = {
  id: string
  client_id: string
  url: string
  name: string | null
  notes: string | null
  last_crawled_at: string | null
  created_at: string
}

export type CompetitorPage = {
  id: string
  competitor_id: string
  client_id: string
  url: string
  title: string | null
  h1: string | null
  word_count: number | null
  keywords: string[] | null
  content_summary: string | null
  crawled_at: string
}
