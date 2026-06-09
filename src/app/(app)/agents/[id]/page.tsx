'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Agent = {
  id: string; name: string; role: string; slug: string; avatar_initials: string
  description: string; instructions: string; backstory: string; expertise: string
  personality: string; communication_style: string; boundaries: string; working_style: string
  agent_type: string; active: boolean
}
type Message = { id: string; role: 'user' | 'assistant'; content: string; created_at: string }
type Conversation = { id: string; title: string; created_at: string }
type Client = { id: string; name: string; description: string; icp: string; usp: string; brand_voice: string; content_goals: string; competitors: string[]; file_tree: string | null; github_repo: string | null }
type PlannedTask = { id: string; primary_keyword: string; content_type: string; supporting_keywords: string[]; title_brief: string; word_count: number; internal_links: string; notes: string; status: string }
type SitePage = { url: string; title: string | null; h1: string | null; meta_description: string | null; word_count: number | null; content_summary: string | null }

function buildSystemPrompt(agent: Agent, clients: Client[], plannedTasks: PlannedTask[], sitePages: Record<string, SitePage[]>): string {
  const parts: string[] = []
  parts.push(`You are ${agent.name}, ${agent.role}.`)
  if (agent.backstory?.trim()) parts.push(`BACKGROUND:\n${agent.backstory}`)
  if (agent.expertise?.trim()) parts.push(`EXPERTISE:\n${agent.expertise}`)
  if (agent.personality?.trim()) parts.push(`PERSONALITY:\n${agent.personality}`)
  if (agent.communication_style?.trim()) parts.push(`HOW YOU COMMUNICATE:\n${agent.communication_style}`)
  if (agent.working_style?.trim()) parts.push(`HOW YOU WORK:\n${agent.working_style}`)
  if (agent.boundaries?.trim()) parts.push(`WHAT YOU NEVER DO:\n${agent.boundaries}`)
  if (agent.instructions?.trim()) parts.push(`ADDITIONAL INSTRUCTIONS:\n${agent.instructions}`)

  parts.push(`HOW TO WORK LIKE A PROFESSIONAL:
You are not a passive assistant. Think, investigate, and act like a real SEO professional would.

When Dan starts a conversation about a client, build context before offering opinions:
- Call audit_site first to understand what is broken or missing
- Call search_history before planning any new content to know what angles are already covered
- Call read_page when you need to understand what a specific live page actually says
- Call read_file when you need the source code before editing it

When you identify an issue, fix it — do not just report it. When Dan asks you to add a blog post, do not ask for permission at each step. Read an existing post to learn the format, write the new one, commit it, and report back what you did.

Think in terms of the bigger picture: keyword gaps, content clusters, internal linking, page quality, site structure. Make recommendations that move the needle.

GITHUB CAPABILITY:
You have direct read and write access to each client's GitHub repo.

read_file: Read any file from the repo. Always do this before editing an existing file.

write_file: Write or update any file. Add blog posts, edit pages, fix SEO issues, change structure. Provide a clear commit message. Report back exactly what changed and why.

Work methodically: read first, understand the format, then write. If adding a blog post, read an existing one so yours matches exactly.

PLANNED TASKS CAPABILITY:
You can create and update planned tasks that appear in the scheduler. When the user asks you to plan, save, or create a future task — or when you have agreed on a content piece — call the save_planned_task function with all the details. When the user asks to update an existing planned task, call update_planned_task with the task id and the fields to change. Always confirm what you saved or updated in your response, listing the key details so the user can verify.

When confirming a saved task, format it clearly:
"Saved to planned tasks:
— [content type]: [primary keyword]
— Supporting: [keywords]
— Brief: [angle]
— Words: [count]
— Links to: [internal links if any]
You'll find it in the scheduler when you're ready to schedule it."`)

  if (clients.length > 0) {
    const clientContext = clients.map(c => [
      `CLIENT: ${c.name}`,
      c.description ? `Description: ${c.description}` : '',
      c.icp ? `Ideal customer: ${c.icp}` : '',
      c.usp ? `USP: ${c.usp}` : '',
      c.brand_voice ? `Brand voice: ${c.brand_voice}` : '',
      c.content_goals ? `Content goals: ${c.content_goals}` : '',
      c.competitors?.length ? `Competitors: ${c.competitors.join(', ')}` : '',
    ].filter(Boolean).join('\n')).join('\n\n---\n\n')
    parts.push(`YOUR CLIENTS:\n\n${clientContext}`)
  }

  // Site pages inventory
  const siteContext = clients.map(c => {
    const pages = sitePages[c.id]
    if (!pages || pages.length === 0) return null
    const pageList = pages.map(p => {
      const path = p.url.replace(/^https?:\/\/[^/]+/, '') || '/'
      const summary = p.content_summary
        ? ` — ${p.content_summary}`
        : (p.h1 ? ` — H1: ${p.h1}` : (p.title ? ` — ${p.title}` : ''))
      const meta = !p.meta_description ? ' [NO META]' : ''
      return `  ${path}${summary}${meta}`
    }).join('\n')
    return `LIVE PAGES — ${c.name} (${pages.length} pages crawled):\n${pageList}`
  }).filter(Boolean).join('\n\n')

  if (siteContext) {
    parts.push(`LIVE SITE INVENTORY:\n\nThese are the actual pages currently live on your clients' websites. Use the exact URLs from this list for internal link recommendations. Never invent or guess URLs — only reference pages you can see here.\n\n${siteContext}`)
  }

  // File tree / codebase
  const codebaseContext = clients.map(c => {
    if (!c.file_tree) return null
    return `CODEBASE FILE TREE — ${c.name} (${c.github_repo || 'GitHub repo'}):\n\nUse this to understand the project structure. Call read_file to read specific files.\n\n${c.file_tree}`
  }).filter(Boolean).join('\n\n')
  if (codebaseContext) parts.push(codebaseContext)

  if (plannedTasks.length > 0) {
    const taskList = plannedTasks.map(t =>
      `ID: ${t.id} | ${t.content_type.replace(/_/g, ' ')} | "${t.primary_keyword}" | status: ${t.status}${t.title_brief ? ` | brief: ${t.title_brief}` : ''}`
    ).join('\n')
    parts.push(`EXISTING PLANNED TASKS (reference these when updating):\n${taskList}`)
  }

  return parts.join('\n\n---\n\n')
}

const TOOLS = [
  {
    name: 'save_planned_task',
    description: 'Save a planned content task to the scheduler. Call this when the user asks to plan or save a future task, or when you have agreed on a content piece to create.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client this task is for' },
        content_type: { type: 'string', enum: ['blog_post', 'pillar_page', 'category_page', 'local_seo'] },
        primary_keyword: { type: 'string' },
        supporting_keywords: { type: 'array', items: { type: 'string' } },
        title_brief: { type: 'string', description: 'The angle or specific direction' },
        word_count: { type: 'number' },
        internal_links: { type: 'string', description: 'Pages or URLs this content should link to' },
        notes: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'ready'] },
      },
      required: ['client_name', 'content_type', 'primary_keyword'],
    },
  },
  {
    name: 'update_planned_task',
    description: 'Update an existing planned task. Call this when the user asks to change or add to a previously saved planned task.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        content_type: { type: 'string', enum: ['blog_post', 'pillar_page', 'category_page', 'local_seo'] },
        primary_keyword: { type: 'string' },
        supporting_keywords: { type: 'array', items: { type: 'string' } },
        title_brief: { type: 'string' },
        word_count: { type: 'number' },
        internal_links: { type: 'string' },
        notes: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'ready'] },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the full content of a specific file from the client codebase on GitHub. Use this when you need to study the actual code or content of a specific page or component before making changes.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client whose repo to read from' },
        file_path: { type: 'string', description: 'The file path relative to repo root, e.g. src/app/page.tsx or content/blog/my-post.mdx' },
      },
      required: ['client_name', 'file_path'],
    },
  },
  {
    name: 'audit_site',
    description: 'Run a full SEO audit on a client\'s crawled site. Returns structured issues: pages missing meta descriptions, thin content, keyword cannibalisation (multiple pages targeting the same keyword), orphan pages with no internal links pointing to them, and pages with no H1. Call this at the start of any strategy conversation to understand the current state before making recommendations.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client to audit' },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'read_page',
    description: 'Read the full crawled content of a specific live page by URL. Use this when you need to deeply analyse what a page actually says — for content gap analysis, editorial improvements, or understanding what is already covered before writing something new.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client' },
        url: { type: 'string', description: 'The full URL of the page to read' },
      },
      required: ['client_name', 'url'],
    },
  },
  {
    name: 'search_history',
    description: 'Search the content history for a client to find previously published pieces on a topic or keyword. Always call this before planning or writing new content to avoid repeating angles and to find internal linking opportunities.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client' },
        query: { type: 'string', description: 'Topic, keyword, or theme to search for' },
      },
      required: ['client_name', 'query'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or update a file in the client\'s GitHub repo. Use this to add blog posts, edit existing pages, update content, or make structural changes. Always read the file first if it already exists so you can make precise edits rather than overwriting the whole thing blindly. Provide a clear commit message describing what changed and why.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client whose repo to write to' },
        file_path: { type: 'string', description: 'The file path relative to repo root' },
        content: { type: 'string', description: 'The full file content to write' },
        commit_message: { type: 'string', description: 'A clear description of what was changed and why' },
      },
      required: ['client_name', 'file_path', 'content', 'commit_message'],
    },
  },
]

const S = {
  btn: { background: '#6366F1', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  btnSm: { background: '#1C1F2A', color: '#8B91A8', border: '1px solid #252836', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  label: { fontSize: 11, color: '#8B91A8', textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: 4, display: 'block' } as React.CSSProperties,
  hint: { fontSize: 12, color: '#5A6070', marginBottom: 8, lineHeight: 1.4 } as React.CSSProperties,
  field: { marginBottom: 24 } as React.CSSProperties,
  sectionHead: { fontSize: 13, fontWeight: 600, color: '#E2E4EE', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid #252836' } as React.CSSProperties,
  section: { marginBottom: 32 } as React.CSSProperties,
}

const SETTINGS_FIELDS = [
  { section: 'Identity', fields: [
    { key: 'name', label: 'Name', hint: 'What she calls herself.', type: 'input' },
    { key: 'role', label: 'Role title', hint: 'Shown on her card.', type: 'input' },
    { key: 'avatar_initials', label: 'Avatar initials', hint: 'Two characters for her avatar.', type: 'input' },
    { key: 'description', label: 'One-line description', hint: 'Shown on the agents page card.', type: 'input' },
  ]},
  { section: 'Background', fields: [
    { key: 'backstory', label: 'Backstory', hint: 'Who she is, where she came from, what shaped her.', type: 'textarea', rows: 5 },
    { key: 'expertise', label: 'Expertise', hint: 'What she genuinely knows in depth.', type: 'textarea', rows: 4 },
  ]},
  { section: 'Personality', fields: [
    { key: 'personality', label: 'Personality', hint: 'Her character, values, what she cares about.', type: 'textarea', rows: 5 },
    { key: 'communication_style', label: 'Communication style', hint: 'How she writes and speaks.', type: 'textarea', rows: 4 },
  ]},
  { section: 'How she works', fields: [
    { key: 'working_style', label: 'Working style', hint: 'How she approaches tasks.', type: 'textarea', rows: 4 },
    { key: 'boundaries', label: 'What she never does', hint: 'Hard rules.', type: 'textarea', rows: 4 },
  ]},
  { section: 'Additional instructions', fields: [
    { key: 'instructions', label: 'Anything else', hint: 'Extra rules or behaviours.', type: 'textarea', rows: 4 },
  ]},
]

export default function AgentPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<'chat' | 'settings'>('chat')
  const [agent, setAgent] = useState<Agent | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConv, setActiveConv] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [plannedTasks, setPlannedTasks] = useState<PlannedTask[]>([])
  const [sitePages, setSitePages] = useState<Record<string, SitePage[]>>({})
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [settings, setSettings] = useState<Partial<Agent>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id) return
    loadAgent(); loadClients(); loadConversations(); loadPlannedTasks()
  }, [id])

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [messages])

  async function loadAgent() {
    const { data } = await supabase.from('agents').select('*').eq('id', id).single()
    if (data) { setAgent(data); setSettings(data) }
  }

  async function loadClients() {
    const { data } = await supabase.from('client_profiles').select('id,name,description,icp,usp,brand_voice,content_goals,competitors,file_tree,github_repo').order('name')
    const clientList = data || []
    setClients(clientList)
    loadSitePages(clientList)
  }

  async function loadSitePages(clientList: Client[]) {
    const pages: Record<string, SitePage[]> = {}
    for (const c of clientList) {
      const { data } = await supabase.from('site_pages').select('url,title,h1,meta_description,word_count,content_summary').eq('client_id', c.id).order('url').limit(100)
      if (data && data.length > 0) pages[c.id] = data
    }
    setSitePages(pages)
  }

  async function loadConversations() {
    const { data } = await supabase.from('conversations').select('*').eq('agent_id', id).order('updated_at', { ascending: false })
    setConversations(data || [])
  }

  async function loadPlannedTasks() {
    const { data } = await supabase.from('planned_tasks').select('*').eq('agent_id', id).neq('status', 'scheduled').order('created_at', { ascending: false })
    setPlannedTasks(data || [])
  }

  async function newConversation() {
    const { data } = await supabase.from('conversations').insert({ agent_id: id, title: 'New conversation' }).select().single()
    if (data) { setConversations(prev => [data, ...prev]); setActiveConv(data.id); setMessages([]) }
  }

  async function loadMessages(convId: string) {
    setActiveConv(convId)
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at')
    setMessages(data || [])
  }

  async function handleToolCall(toolName: string, toolInput: any, convId: string): Promise<string> {
    if (toolName === 'save_planned_task') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Could not find client matching "${toolInput.client_name}".`
      const { data, error } = await supabase.from('planned_tasks').insert({
        agent_id: id, client_id: client.id, conversation_id: convId,
        content_type: toolInput.content_type || 'blog_post',
        primary_keyword: toolInput.primary_keyword,
        supporting_keywords: toolInput.supporting_keywords || [],
        title_brief: toolInput.title_brief || null,
        word_count: toolInput.word_count || 1200,
        internal_links: toolInput.internal_links || null,
        notes: toolInput.notes || null,
        status: toolInput.status || 'ready',
      }).select().single()
      if (error) return `Failed to save task: ${error.message}`
      loadPlannedTasks()
      return `Task saved successfully with ID: ${data.id}`
    }
    if (toolName === 'update_planned_task') {
      const updates: any = { updated_at: new Date().toISOString() }
      if (toolInput.content_type) updates.content_type = toolInput.content_type
      if (toolInput.primary_keyword) updates.primary_keyword = toolInput.primary_keyword
      if (toolInput.supporting_keywords) updates.supporting_keywords = toolInput.supporting_keywords
      if (toolInput.title_brief) updates.title_brief = toolInput.title_brief
      if (toolInput.word_count) updates.word_count = toolInput.word_count
      if (toolInput.internal_links) updates.internal_links = toolInput.internal_links
      if (toolInput.notes) updates.notes = toolInput.notes
      if (toolInput.status) updates.status = toolInput.status
      const { error } = await supabase.from('planned_tasks').update(updates).eq('id', toolInput.task_id)
      if (error) return `Failed to update task: ${error.message}`
      loadPlannedTasks()
      return `Task ${toolInput.task_id} updated successfully.`
    }
    if (toolName === 'read_file') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Could not find client matching "${toolInput.client_name}".`
      try {
        const res = await fetch(`/api/github?client_id=${client.id}&path=${encodeURIComponent(toolInput.file_path)}`)
        const data = await res.json()
        if (data.error) return `Could not read file: ${data.error}`
        return `File: ${toolInput.file_path}\n\n${data.content}`
      } catch { return 'Failed to read file.' }
    }

    if (toolName === 'audit_site') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Could not find client matching "${toolInput.client_name}".`
      const pages = sitePages[client.id] || []
      if (pages.length === 0) return 'No crawled pages found for this client. Run a site crawl first.'

      const issues: string[] = []

      // Missing meta descriptions
      const noMeta = pages.filter(p => !p.meta_description)
      if (noMeta.length > 0) issues.push(`MISSING META DESCRIPTIONS (${noMeta.length} pages):\n${noMeta.map(p => `  ${p.url}`).join('\n')}`)

      // Missing H1
      const noH1 = pages.filter(p => !p.h1)
      if (noH1.length > 0) issues.push(`MISSING H1 (${noH1.length} pages):\n${noH1.map(p => `  ${p.url}`).join('\n')}`)

      // Thin content (under 300 words)
      const thin = pages.filter(p => p.word_count !== null && p.word_count < 300)
      if (thin.length > 0) issues.push(`THIN CONTENT under 300 words (${thin.length} pages):\n${thin.map(p => `  ${p.url} — ${p.word_count} words`).join('\n')}`)

      // Keyword cannibalisation — fetch keyword_banks to compare
      const { data: keywords } = await supabase.from('keyword_banks').select('keyword,content_targeting_this').eq('client_id', client.id)
      if (keywords && keywords.length > 0) {
        const targeted = keywords.filter(k => k.content_targeting_this)
        const urlCounts: Record<string, string[]> = {}
        for (const k of targeted) {
          if (!urlCounts[k.content_targeting_this]) urlCounts[k.content_targeting_this] = []
          urlCounts[k.content_targeting_this].push(k.keyword)
        }
        // Pages targeting more than one keyword (possible cannibalisation)
        const cannibalised = Object.entries(urlCounts).filter(([, kws]) => kws.length > 3)
        if (cannibalised.length > 0) issues.push(`POSSIBLE KEYWORD CANNIBALISATION (pages targeting many keywords):\n${cannibalised.map(([url, kws]) => `  ${url} — ${kws.join(', ')}`).join('\n')}`)

        // Keywords with no content assigned
        const untargeted = keywords.filter(k => !k.content_targeting_this)
        if (untargeted.length > 0) issues.push(`KEYWORDS WITH NO CONTENT (${untargeted.length}):\n${untargeted.map(k => `  ${k.keyword}`).join('\n')}`)
      }

      // Summary stats
      const avgWords = pages.length > 0 ? Math.round(pages.reduce((a, p) => a + (p.word_count || 0), 0) / pages.length) : 0
      const summary = `AUDIT SUMMARY — ${client.name}\nPages crawled: ${pages.length} | Avg word count: ${avgWords} | Issues found: ${issues.length > 0 ? issues.reduce((a, i) => a + i.split('\n').length, 0) : 0}`

      return [summary, ...issues].join('\n\n') || `No critical issues found across ${pages.length} pages.`
    }

    if (toolName === 'read_page') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Could not find client matching "${toolInput.client_name}".`
      const { data } = await supabase.from('site_pages').select('url,title,h1,meta_description,word_count,content,content_summary,internal_links').eq('client_id', client.id).eq('url', toolInput.url).single()
      if (!data) return `Page not found in crawl data: ${toolInput.url}. Try running a fresh crawl.`
      return [
        `URL: ${data.url}`,
        `Title: ${data.title || 'none'}`,
        `H1: ${data.h1 || 'none'}`,
        `Meta description: ${data.meta_description || 'MISSING'}`,
        `Word count: ${data.word_count || 0}`,
        `Internal links: ${(data.internal_links || []).join(', ') || 'none'}`,
        `\nFull content:\n${data.content || 'No content stored. Re-crawl to capture full content.'}`,
      ].join('\n')
    }

    if (toolName === 'search_history') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Could not find client matching "${toolInput.client_name}".`
      const query = (toolInput.query || '').toLowerCase()
      const { data } = await supabase.from('content_history').select('title,url,primary_keyword,summary,published_at,performance_notes').eq('client_id', client.id).order('published_at', { ascending: false })
      if (!data || data.length === 0) return `No content history found for ${client.name}.`
      const matches = data.filter(h =>
        (h.title || '').toLowerCase().includes(query) ||
        (h.primary_keyword || '').toLowerCase().includes(query) ||
        (h.summary || '').toLowerCase().includes(query)
      )
      if (matches.length === 0) return `No published content matching "${toolInput.query}" found for ${client.name}. Total history: ${data.length} pieces.`
      return `Content history matching "${toolInput.query}" for ${client.name}:\n\n` + matches.map(h =>
        `Title: ${h.title}\nKeyword: ${h.primary_keyword || 'not set'}\nURL: ${h.url || 'not published'}\nPublished: ${h.published_at ? new Date(h.published_at).toLocaleDateString('en-GB') : 'unknown'}\nAngle: ${h.summary || 'no summary'}\nPerformance: ${h.performance_notes || 'no data yet'}`
      ).join('\n\n---\n\n')
    }

    if (toolName === 'write_file') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Could not find client matching "${toolInput.client_name}".`
      try {
        const res = await fetch('/api/github', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: client.id,
            path: toolInput.file_path,
            content: toolInput.content,
            message: toolInput.commit_message,
          }),
        })
        const data = await res.json()
        if (data.error) return `Failed to write file: ${data.error}`
        return `File written successfully: ${toolInput.file_path}\nCommit: ${toolInput.commit_message}\nURL: ${data.url}`
      } catch { return 'Failed to write file.' }
    }

    return 'Unknown tool.'
  }

  async function send() {
    if (!draft.trim() || !agent || sending) return
    let convId = activeConv
    if (!convId) {
      const { data } = await supabase.from('conversations').insert({ agent_id: id, title: draft.slice(0, 60) }).select().single()
      if (!data) return
      convId = data.id; setActiveConv(convId); setConversations(prev => [data, ...prev])
    }
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: draft, created_at: new Date().toISOString() }
    const placeholder: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', created_at: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg, placeholder])
    setDraft(''); setSending(true)
    await supabase.from('messages').insert({ conversation_id: convId, role: 'user', content: userMsg.content })
    const history = [...messages.filter(m => m.content), userMsg]
    const systemPrompt = buildSystemPrompt(agent, clients, plannedTasks, sitePages)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, system: systemPrompt, tools: TOOLS, messages: history.map(m => ({ role: m.role, content: m.content })) }),
      })
      const data = await res.json()
      if (data.stop_reason === 'tool_use') {
        const toolUseBlock = data.content.find((b: any) => b.type === 'tool_use')
        if (toolUseBlock) {
          const toolResult = await handleToolCall(toolUseBlock.name, toolUseBlock.input, convId!)
          const continueRes = await fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, system: systemPrompt, tools: TOOLS, messages: [...history.map(m => ({ role: m.role, content: m.content })), { role: 'assistant', content: data.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: toolResult }] }] }),
          })
          const continueData = await continueRes.json()
          const reply = (continueData.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
          await supabase.from('messages').insert({ conversation_id: convId, role: 'assistant', content: reply })
          await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId)
          setMessages(prev => prev.map(m => m.id === placeholder.id ? { ...m, content: reply } : m))
        }
      } else {
        const reply = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
        await supabase.from('messages').insert({ conversation_id: convId, role: 'assistant', content: reply })
        await supabase.from('conversations').update({ updated_at: new Date().toISOString(), title: userMsg.content.slice(0, 60) }).eq('id', convId)
        setMessages(prev => prev.map(m => m.id === placeholder.id ? { ...m, content: reply } : m))
      }
    } catch { setMessages(prev => prev.map(m => m.id === placeholder.id ? { ...m, content: 'Something went wrong. Try again.' } : m)) }
    setSending(false)
  }

  async function saveSettings() {
    if (!settings.name?.trim()) return
    setSaving(true)
    await supabase.from('agents').update({ name: settings.name, role: settings.role, avatar_initials: settings.avatar_initials || settings.name?.slice(0, 2).toUpperCase(), description: settings.description, backstory: settings.backstory, expertise: settings.expertise, personality: settings.personality, communication_style: settings.communication_style, working_style: settings.working_style, boundaries: settings.boundaries, instructions: settings.instructions, active: settings.active }).eq('id', id)
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000); loadAgent()
  }

  function setSetting(k: keyof Agent, v: any) { setSettings(s => ({ ...s, [k]: v })) }
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const clock = (d: string) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (!agent) return <div style={{ color: '#8B91A8', fontSize: 14 }}>Loading...</div>

  return (
    <div style={{ height: 'calc(100vh - 72px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24, flexShrink: 0 }}>
        <div style={{ width: 48, height: 48, borderRadius: 11, background: '#1C1F2A', border: '1px solid #2A2D3A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600, color: '#6366F1', fontFamily: '"JetBrains Mono", monospace', flexShrink: 0 }}>
          {agent.avatar_initials || agent.name.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#E2E4EE' }}>{agent.name}</div>
          <div style={{ fontSize: 12, color: '#6366F1', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{agent.role}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {Object.keys(sitePages).length > 0 && (
            <span style={{ fontSize: 11, color: '#34D399', fontFamily: '"JetBrains Mono",monospace' }}>
              {Object.values(sitePages).reduce((a, b) => a + b.length, 0)} pages loaded
            </span>
          )}
          {(['chat', 'settings'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ ...S.btnSm, background: tab === t ? '#6366F1' : '#1C1F2A', color: tab === t ? '#fff' : '#8B91A8', border: tab === t ? 'none' : '1px solid #252836', textTransform: 'capitalize' }}>{t}</button>
          ))}
        </div>
      </div>

      {tab === 'chat' && (
        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
          <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button style={{ ...S.btn, width: '100%', marginBottom: 4 }} onClick={newConversation}>+ New chat</button>
            {plannedTasks.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: '#8B91A8', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6, padding: '0 2px' }}>Planned tasks</div>
                {plannedTasks.slice(0, 5).map(t => (
                  <div key={t.id} style={{ padding: '8px 10px', borderRadius: 7, background: '#1C1F2A', border: '1px solid #252836', marginBottom: 4 }}>
                    <div style={{ fontSize: 12, color: '#E2E4EE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.primary_keyword}</div>
                    <div style={{ fontSize: 10, color: t.status === 'ready' ? '#34D399' : '#F59E0B', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>{t.status}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 10, color: '#8B91A8', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4, padding: '0 2px' }}>Conversations</div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              {conversations.map(c => (
                <button key={c.id} onClick={() => loadMessages(c.id)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 8, background: activeConv === c.id ? '#1C1F2A' : 'transparent', border: activeConv === c.id ? '1px solid #252836' : '1px solid transparent', cursor: 'pointer', marginBottom: 3 }}>
                  <div style={{ fontSize: 13, color: '#E2E4EE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || 'Conversation'}</div>
                  <div style={{ fontSize: 11, color: '#8B91A8', marginTop: 2, fontFamily: '"JetBrains Mono",monospace' }}>{fmt(c.created_at)}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {!activeConv ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#E2E4EE' }}>Start a conversation with {agent.name}</div>
                <div style={{ fontSize: 14, color: '#8B91A8', textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>
                  {agent.name} knows your clients, their keyword banks, and every live page on their websites.
                  {Object.keys(sitePages).length === 0 && <span style={{ color: '#F59E0B' }}> Crawl a client site first to give her full page knowledge.</span>}
                </div>
                <button style={{ ...S.btn, marginTop: 8 }} onClick={newConversation}>Start chatting</button>
              </div>
            ) : (
              <>
                <div ref={scroller} style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 8 }}>
                  {messages.length === 0 && <div style={{ margin: 'auto' }}><div style={{ fontSize: 15, color: '#8B91A8' }}>Say something to get started.</div></div>}
                  {messages.map((m, i) => (
                    <div key={m.id || i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div style={{ padding: '12px 16px', borderRadius: 12, fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap', background: m.role === 'user' ? '#6366F1' : '#1C1F2A', color: m.role === 'user' ? '#fff' : '#E2E4EE', borderBottomRightRadius: m.role === 'user' ? 3 : 12, borderBottomLeftRadius: m.role === 'assistant' ? 3 : 12 }}>
                        {m.content || <span style={{ opacity: 0.5 }}>Thinking...</span>}
                      </div>
                      <div style={{ fontSize: 11, color: '#8B91A8', marginTop: 4, fontFamily: '"JetBrains Mono",monospace' }}>{m.role === 'assistant' ? agent.name : 'You'} · {clock(m.created_at)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10, paddingTop: 12, borderTop: '1px solid #252836', alignItems: 'flex-end', flexShrink: 0 }}>
                  <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder={`Message ${agent.name}...`} rows={2} style={{ flex: 1, resize: 'none', background: '#1C1F2A', border: '1px solid #252836', borderRadius: 10, padding: '12px 14px', fontSize: 14, color: '#E2E4EE', outline: 'none', lineHeight: 1.5, fontFamily: 'inherit' }} />
                  <button onClick={send} disabled={!draft.trim() || sending} style={{ ...S.btn, flexShrink: 0, opacity: (!draft.trim() || sending) ? 0.4 : 1 }}>{sending ? '...' : 'Send'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div style={{ overflow: 'auto', flex: 1 }}>
          <div style={{ maxWidth: 680 }}>
            <p style={{ fontSize: 14, color: '#8B91A8', marginBottom: 32, lineHeight: 1.6 }}>Every field here shapes how {agent.name} thinks, speaks and behaves. Changes take effect on the next message.</p>
            {SETTINGS_FIELDS.map(({ section, fields }) => (
              <div key={section} style={S.section}>
                <div style={S.sectionHead}>{section}</div>
                {fields.map(({ key, label, hint, type, rows }) => (
                  <div key={key} style={S.field}>
                    <label style={S.label}>{label}</label>
                    {hint && <div style={S.hint}>{hint}</div>}
                    {type === 'textarea' ? <textarea rows={rows || 3} value={(settings as any)[key] || ''} onChange={e => setSetting(key as keyof Agent, e.target.value)} style={{ lineHeight: 1.6 }} /> : <input type="text" value={(settings as any)[key] || ''} onChange={e => setSetting(key as keyof Agent, e.target.value)} />}
                  </div>
                ))}
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 40 }}>
              <button style={S.btn} onClick={saveSettings} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
              {saved && <span style={{ fontSize: 13, color: '#34D399', fontWeight: 500 }}>Saved</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
