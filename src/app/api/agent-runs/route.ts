export const maxDuration = 300

import { after, NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { safeDecrypt } from '@/lib/crypto'
import { getSupabaseAdmin, requireUser } from '@/lib/server/auth'
import { readJsonWithLimit } from '@/lib/server/request-body'
import { checkUserBudget, recordTokenUsage, SESSION_TOKEN_LIMIT } from '@/lib/server/token-usage'
import { cleanContent } from '@/lib/content-clean'

type TaskEntry = { label: string; done: boolean; ts: string }

function encodeMessageMeta(content: string, taskLog: TaskEntry[], thoughts: string[] = []): string {
  if (!taskLog.length && !thoughts.length) return content
  return `__META__${JSON.stringify({ taskLog, thoughts })}__ENDMETA__\n${content}`
}

function clock(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function stripToolCallJson(content: string): string {
  let clean = content || ''
  clean = clean.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (block, body) =>
    /["']tool_name["']|["']parameters["']/.test(body) ? '' : block
  )
  clean = clean.replace(/(^|\n)\s*(\[\s*\{[\s\S]*?["']tool_name["'][\s\S]*?\}\s*\])\s*(?=\n|$)/gi, '$1')
  clean = clean.replace(/(^|\n)\s*(\{\s*["']tool_name["'][\s\S]*?\})\s*(?=\n|$)/gi, '$1')
  return clean.replace(/\n{3,}/g, '\n\n').trim()
}

function absoluteAppUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || 'http://localhost:3000'
  const normalized = base.startsWith('http') ? base : `https://${base}`
  return `${normalized.replace(/\/$/, '')}${path}`
}

async function getAnthropicKey(supabase: SupabaseClient, userId: string): Promise<{ key: string; workspaceId: string | null }> {
  let anthropicKey = process.env.ANTHROPIC_API_KEY || ''
  let workspaceId: string | null = null

  const [{ data: wsRow }, { data: settings }] = await Promise.all([
    supabase.from('workspaces').select('id').eq('owner_id', userId).maybeSingle(),
    supabase.from('workspace_settings').select('anthropic_api_key').eq('user_id', userId).maybeSingle(),
  ])

  if (wsRow) workspaceId = wsRow.id
  if (settings?.anthropic_api_key) {
    const decrypted = safeDecrypt(settings.anthropic_api_key)
    anthropicKey = decrypted || settings.anthropic_api_key
  }
  return { key: anthropicKey, workspaceId }
}

const TOOL_STATUS: Record<string, string> = {
  read_output_draft: 'Reading draft...',
  generate_images: 'Generating images with Nano Banana...',
  update_output_draft: 'Updating draft...',
}

const tools = [
  {
    name: 'read_output_draft',
    description: 'Read an existing draft from content_outputs. Use output_id if provided, otherwise find by client_name and query.',
    input_schema: {
      type: 'object',
      properties: {
        output_id: { type: 'string' },
        client_name: { type: 'string' },
        query: { type: 'string' },
      },
    },
  },
  {
    name: 'generate_images',
    description: 'Generate relevant article images and return public Supabase image URLs. Use when the user explicitly asks for images or image embedding.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string' },
        client_id: { type: 'string' },
        images: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              alt_text: { type: 'string' },
              filename: { type: 'string' },
            },
          },
        },
      },
      required: ['images'],
    },
  },
  {
    name: 'update_output_draft',
    description: 'Update an existing draft in content_outputs after revising it. Do not create a new draft for revisions.',
    input_schema: {
      type: 'object',
      properties: {
        output_id: { type: 'string' },
        content: { type: 'string' },
        title: { type: 'string' },
        meta_description: { type: 'string' },
        primary_keyword: { type: 'string' },
        images: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              alt_text: { type: 'string' },
              filename: { type: 'string' },
              storage_path: { type: 'string' },
            },
          },
        },
      },
      required: ['output_id', 'content'],
    },
  },
]

async function updateAssistantMessage(
  supabase: SupabaseClient,
  messageId: string,
  content: string,
  taskLog: TaskEntry[],
  thoughts: string[] = [],
) {
  const { error } = await supabase
    .from('messages')
    .update({ content: encodeMessageMeta(content, taskLog, thoughts) })
    .eq('id', messageId)
  if (error) console.error('[agent-runs] message update failed:', error.message)
}

async function handleTool(
  supabase: SupabaseClient,
  toolName: string,
  toolInput: any,
  opts: { authHeader: string; userId: string; workspaceId: string | null },
): Promise<string> {
  if (toolName === 'read_output_draft') {
    let query = supabase
      .from('content_outputs')
      .select('id, client_id, title, content, primary_keyword, meta_description, word_count, images, approved, published_url, current_version, created_at, client_profiles(name)')
      .order('created_at', { ascending: false })

    if (toolInput.output_id) {
      query = query.eq('id', toolInput.output_id).limit(1)
    } else {
      if (toolInput.client_name) {
        const { data: client } = await supabase
          .from('client_profiles')
          .select('id')
          .ilike('name', `%${String(toolInput.client_name).replace(/[%_]/g, '\\$&')}%`)
          .limit(1)
          .maybeSingle()
        if (client?.id) query = query.eq('client_id', client.id)
      }
      const search = String(toolInput.query || '').trim()
      if (search) {
        const escaped = search.replace(/[%_]/g, '\\$&')
        query = query.or(`title.ilike.%${escaped}%,primary_keyword.ilike.%${escaped}%`)
      }
      query = query.is('published_url', null).limit(5)
    }

    const { data: rows, error } = await query
    const matches = rows || []
    if (error || matches.length === 0) return JSON.stringify({ success: false, error: 'Draft not found.' })
    if (!toolInput.output_id && matches.length > 1) {
      return JSON.stringify({
        success: false,
        needs_selection: true,
        matches: matches.map((m: any) => ({
          output_id: m.id,
          title: m.title,
          primary_keyword: m.primary_keyword,
          client_name: m.client_profiles?.name || '',
          review_url: `/outputs/${m.id}`,
        })),
      })
    }
    const output = matches[0] as any
    return JSON.stringify({
      success: true,
      output_id: output.id,
      client_id: output.client_id,
      client_name: output.client_profiles?.name || '',
      title: output.title,
      primary_keyword: output.primary_keyword,
      meta_description: output.meta_description,
      word_count: output.word_count,
      images: output.images || [],
      current_version: output.current_version || 1,
      content: output.content,
    })
  }

  if (toolName === 'generate_images') {
    const images: any[] = Array.isArray(toolInput.images) ? toolInput.images : []
    if (!images.length) return JSON.stringify({ success: false, error: 'No images provided.' })
    let clientId = toolInput.client_id || null
    if (!clientId && toolInput.client_name) {
      const { data: client } = await supabase
        .from('client_profiles')
        .select('id')
        .ilike('name', `%${String(toolInput.client_name).replace(/[%_]/g, '\\$&')}%`)
        .limit(1)
        .maybeSingle()
      clientId = client?.id || null
    }

    const generated = await Promise.all(images.slice(0, 4).map(async (img) => {
      const res = await fetch(absoluteAppUrl('/api/generate-image'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: opts.authHeader,
        },
        body: JSON.stringify({
          prompt: img.prompt,
          filename: img.filename,
          client_id: clientId,
          resolution: '1K',
          aspect_ratio: '16:9',
        }),
      })
      const data = await res.json().catch(() => ({}))
      return {
        url: data.url,
        filename: data.filename || img.filename,
        storage_path: data.storage_path,
        alt_text: img.alt_text,
        skipped: data.skipped,
        error: data.error,
      }
    }))

    return JSON.stringify({ success: true, images: generated.filter(img => img.url) })
  }

  if (toolName === 'update_output_draft') {
    const { data: existing, error: loadError } = await supabase
      .from('content_outputs')
      .select('*')
      .eq('id', toolInput.output_id)
      .single()
    if (loadError || !existing) return JSON.stringify({ success: false, error: 'Draft not found.' })
    if (existing.published_url) return JSON.stringify({ success: false, error: 'This output is already published.' })

    const currentVersion = existing.current_version || 1
    await supabase.from('output_versions').insert({
      output_id: existing.id,
      version_number: currentVersion,
      content: existing.content,
      title: existing.title,
      meta_description: existing.meta_description,
      word_count: existing.word_count,
      edited_by: 'ada',
    })

    const cleaned = cleanContent(toolInput.content || '')
    const wordCount = cleaned.replace(/^---[\s\S]*?---\s*/, '').trim().split(/\s+/).filter(Boolean).length
    const update: Record<string, any> = {
      content: cleaned,
      word_count: wordCount,
      current_version: currentVersion + 1,
      last_edited_at: new Date().toISOString(),
    }
    if (toolInput.title) update.title = toolInput.title
    if (toolInput.meta_description) update.meta_description = toolInput.meta_description
    if (toolInput.primary_keyword) update.primary_keyword = toolInput.primary_keyword
    if (Array.isArray(toolInput.images)) update.images = toolInput.images

    const { data: updated, error: updateError } = await supabase
      .from('content_outputs')
      .update(update)
      .eq('id', existing.id)
      .select('id,title,word_count,images')
      .single()
    if (updateError || !updated) return JSON.stringify({ success: false, error: updateError?.message || 'Failed to update draft.' })
    return JSON.stringify({
      success: true,
      output_id: existing.id,
      review_url: `/outputs/${existing.id}`,
      word_count: updated.word_count || wordCount,
      image_count: (updated.images || []).length,
    })
  }

  return JSON.stringify({ success: false, error: `Unknown tool ${toolName}` })
}

async function runAgentServerSide(opts: {
  supabase: SupabaseClient
  userId: string
  workspaceId: string | null
  agentId: string
  conversationId: string
  assistantMessageId: string
  prompt: string
  authHeader: string
  anthropicKey: string
}) {
  const { supabase, userId, workspaceId, agentId, conversationId, assistantMessageId, prompt, authHeader, anthropicKey } = opts
  const taskLog: TaskEntry[] = []
  const thoughts: string[] = []
  const addTask = async (label: string) => {
    taskLog.push({ label, done: false, ts: clock() })
    await updateAssistantMessage(supabase, assistantMessageId, 'Run in progress...', taskLog, thoughts)
  }
  const completeTask = async (index: number) => {
    taskLog[index] = { ...taskLog[index], done: true }
    await updateAssistantMessage(supabase, assistantMessageId, 'Run in progress...', taskLog, thoughts)
  }

  const system = `You are Ada inside Agencee, running server-side so the browser can refresh safely.

Your job is to complete draft revision requests against content_outputs.

Rules:
- If the user refers to a draft by title/keyword/client, call read_output_draft with client_name and query.
- If an output ID is present, call read_output_draft with output_id.
- If the user asks for images, call generate_images after reading the draft. Create SEO filenames and descriptive alt text.
- Embed generated image URLs naturally in the markdown.
- Save the revised article back to the same draft using update_output_draft.
- Do not create a separate new draft.
- End with the complete revised article and the review URL.`

  const messages: any[] = [{ role: 'user', content: prompt }]
  let clientId: string | null = null
  let totalTokens = 0

  try {
    for (let loop = 0; loop < 8; loop++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 16000,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          tools,
          messages,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error?.message || `Anthropic returned ${res.status}`)

      if (data.usage) totalTokens += (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)

      const text = stripToolCallJson((data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim())
      if (text) {
        thoughts.push(text)
        await updateAssistantMessage(supabase, assistantMessageId, 'Run in progress...', taskLog, thoughts)
      }

      if (data.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: data.content })
        const toolBlocks = data.content.filter((b: any) => b.type === 'tool_use')
        const results = []
        for (const block of toolBlocks) {
          const index = taskLog.length
          await addTask(TOOL_STATUS[block.name] || `Using ${block.name}...`)
          const result = await handleTool(supabase, block.name, block.input, { authHeader, userId, workspaceId })
          const parsed = JSON.parse(result)
          if (parsed.client_id) clientId = parsed.client_id
          await completeTask(index)
          results.push({ type: 'tool_result', tool_use_id: block.id, content: result.length > 8000 ? `${result.slice(0, 8000)}\n\n[truncated]` : result })
        }
        messages.push({ role: 'user', content: results })
        continue
      }

      const finalReply = text || 'Done.'
      await updateAssistantMessage(supabase, assistantMessageId, finalReply, taskLog, thoughts)
      await supabase.from('conversations').update({ updated_at: new Date().toISOString(), title: prompt.slice(0, 60) }).eq('id', conversationId)
      if (totalTokens > 0) {
        await recordTokenUsage({
          supabase,
          userId,
          workspaceId,
          clientId,
          agentId,
          action: 'server_agent_run',
          tokensUsed: totalTokens,
        })
      }
      return
    }
    await updateAssistantMessage(supabase, assistantMessageId, 'Run stopped after reaching the server loop limit. Please ask Ada to continue from the current draft.', taskLog, thoughts)
  } catch (e: any) {
    await updateAssistantMessage(supabase, assistantMessageId, `⚠️ ${e.message || 'Server-side run failed.'}`, taskLog, thoughts)
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const bodyResult = await readJsonWithLimit<any>(req, 100_000)
  if (!bodyResult.ok) return bodyResult.response
  const { agent_id, conversation_id, prompt, session_tokens = 0 } = bodyResult.data

  if (!agent_id || !prompt) return NextResponse.json({ error: 'agent_id and prompt are required' }, { status: 400 })
  if (Number(session_tokens || 0) >= SESSION_TOKEN_LIMIT) {
    return NextResponse.json({ error: 'Session token limit reached.', session_limit_exceeded: true }, { status: 402 })
  }

  const supabase = getSupabaseAdmin()
  const userId = authResult.auth.user.id
  const budgetCheck = await checkUserBudget(supabase, userId)
  if (!budgetCheck.ok && budgetCheck.response) return budgetCheck.response

  const { key: anthropicKey, workspaceId } = await getAnthropicKey(supabase, userId)
  if (!anthropicKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured.' }, { status: 500 })

  let convId = conversation_id || null
  if (!convId) {
    const { data: conv, error } = await supabase
      .from('conversations')
      .insert({ agent_id, title: String(prompt).slice(0, 60), user_id: userId, workspace_id: workspaceId })
      .select('id')
      .single()
    if (error || !conv) return NextResponse.json({ error: error?.message || 'Failed to create conversation.' }, { status: 500 })
    convId = conv.id
  }

  await supabase.from('messages').insert({ conversation_id: convId, role: 'user', content: prompt, user_id: userId, workspace_id: workspaceId })
  const { data: assistant, error: assistantError } = await supabase
    .from('messages')
    .insert({ conversation_id: convId, role: 'assistant', content: 'Run in progress...', user_id: userId, workspace_id: workspaceId })
    .select('id')
    .single()
  if (assistantError || !assistant) return NextResponse.json({ error: assistantError?.message || 'Failed to create run message.' }, { status: 500 })

  const authHeader = req.headers.get('authorization') || ''
  after(async () => {
    await runAgentServerSide({
      supabase,
      userId,
      workspaceId,
      agentId: agent_id,
      conversationId: convId,
      assistantMessageId: assistant.id,
      prompt,
      authHeader,
      anthropicKey,
    })
  })

  return NextResponse.json({
    success: true,
    conversation_id: convId,
    assistant_message_id: assistant.id,
    status: 'running',
  })
}
