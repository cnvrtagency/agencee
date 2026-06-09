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
  created_at: string
}
