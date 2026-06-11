'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { marked } from 'marked'
import { cleanContent } from '@/lib/content-clean'
import { estimateHaikuCost, estimateSonnetCost } from '@/lib/pricing'

marked.setOptions({ breaks: true, gfm: true })

type Agent = {
  id: string; name: string; role: string; slug: string; avatar_initials: string
  description: string; instructions: string; backstory: string; expertise: string
  personality: string; communication_style: string; boundaries: string; working_style: string
  agent_type: string; active: boolean
}
type TaskEntry = { label: string; done: boolean; ts: string }
type DraftCard = { title: string; word_count: number; image_count: number; review_url: string }
type Message = { id: string; role: 'user' | 'assistant'; content: string; created_at: string; _taskLog?: TaskEntry[]; _thoughts?: string[]; _draftCard?: DraftCard }

// Encode/decode task log + thoughts into message content so it survives DB round-trips
function encodeMessageMeta(content: string, taskLog: TaskEntry[], thoughts: string[]): string {
  if (!taskLog.length && !thoughts.length) return content
  return `__META__${JSON.stringify({ taskLog, thoughts })}__ENDMETA__\n${content}`
}
function decodeMessageMeta(raw: string): { content: string; taskLog: TaskEntry[]; thoughts: string[] } {
  const sep = '__ENDMETA__\n'
  const start = raw.indexOf('__META__')
  const end = raw.indexOf(sep)
  if (start !== 0 || end === -1) return { content: raw, taskLog: [], thoughts: [] }
  const jsonPart = raw.slice(8, end)
  const contentPart = raw.slice(end + sep.length)
  try {
    const { taskLog, thoughts } = JSON.parse(jsonPart)
    return { content: contentPart, taskLog: taskLog || [], thoughts: thoughts || [] }
  } catch { return { content: raw, taskLog: [], thoughts: [] } }
}
type Conversation = { id: string; title: string; created_at: string }
type Client = {
  id: string; name: string; description: string; icp: string; usp: string;
  brand_voice: string; content_goals: string; competitors: string[];
  file_tree: string | null; github_repo: string | null; slug: string | null;
  industry?: string | null; website?: string | null;
  pricing_info?: string; team_info?: string; trust_signals?: string;
  service_differentiators?: string; location_info?: string; target_keywords?: string;
  content_tone?: string; avoid_topics?: string; cta_approach?: string; schema_type?: string;
}
type PlannedTask = { id: string; primary_keyword: string; content_type: string; supporting_keywords: string[]; title_brief: string; word_count: number; internal_links: string; notes: string; status: string }
type SitePage = { url: string; title: string | null; h1: string | null; meta_description: string | null; word_count: number | null; content_summary: string | null }
type GscRow = { query: string; page: string; position: number; impressions: number; clicks: number; ctr: number; period_start?: string; period_end?: string }

function buildSystemPrompt(agent: Agent, clients: Client[], knowledgePanels: Record<string, any> = {}, digest?: { summary: string; week_of: string } | null): string {
  const parts: string[] = []

  // Identity
  parts.push(`You are ${agent.name}, ${agent.role}.`)
  if (agent.backstory?.trim())           parts.push(`BACKGROUND:\n${agent.backstory}`)
  if (agent.expertise?.trim())           parts.push(`EXPERTISE:\n${agent.expertise}`)
  if (agent.personality?.trim())         parts.push(`PERSONALITY:\n${agent.personality}`)
  if (agent.communication_style?.trim()) parts.push(`HOW YOU COMMUNICATE:\n${agent.communication_style}`)
  if (agent.working_style?.trim())       parts.push(`HOW YOU WORK:\n${agent.working_style}`)
  if (agent.boundaries?.trim())          parts.push(`WHAT YOU NEVER DO:\n${agent.boundaries}`)
  if (agent.instructions?.trim())        parts.push(`ADDITIONAL INSTRUCTIONS:\n${agent.instructions}`)

  // Universal working principles
  parts.push(`WORKING PRINCIPLES:
You are an expert professional, not a passive assistant. You have access to a full tool set — use whatever tools the task requires, regardless of your specialty. Your role determines your expertise and perspective, not your tool access.

Before making any substantive recommendation or starting any task:
- Check what you already know from the knowledge panel below — this is your primary source of truth for site structure and recent performance
- Use live tool calls only for data that could have changed since the last sync, or for tasks the knowledge panel cannot answer
- Never make claims about a client's content, rankings, or site structure without grounding them in data you have actually read

When a task is clear: acknowledge briefly and start working immediately.
When a task is ambiguous or broad: ask one focused question before starting. Offer 2-3 specific options as part of that question so the user can respond quickly.

Never print internal tool calls, JSON tool plans, or arrays like [{"tool_name": "..."}] in the chat. Use the actual tools silently and only show the user your plain-language result.

Always reconcile all available data sources before drawing conclusions. If the keyword bank says a keyword is untargeted but the knowledge panel shows a live page covering that topic, say so — and read that page before recommending new content on the same angle.

- Use update_agent_notes at the end of any conversation where you learned something useful about a client — preferences, patterns, things to avoid, tone adjustments. This persists across sessions and makes you more useful over time.`)

  // Client context
  if (clients.length > 0) {
    const clientContext = clients.map(c => {
      const fields = [
        `CLIENT: ${c.name}`,
        c.description             ? `About: ${c.description}` : '',
        c.industry                ? `Industry: ${c.industry}` : '',
        c.website                 ? `Website: ${c.website}` : '',
        c.icp                     ? `Customer: ${c.icp}` : '',
        c.usp                     ? `USP: ${c.usp}` : '',
        c.brand_voice             ? `Voice: ${c.brand_voice}` : '',
        c.content_goals           ? `Goals: ${c.content_goals}` : '',
        c.content_tone            ? `Tone: ${c.content_tone}` : '',
        c.avoid_topics            ? `Avoid: ${c.avoid_topics}` : '',
        c.cta_approach            ? `CTA: ${c.cta_approach}` : '',
        c.pricing_info            ? `Pricing: ${c.pricing_info}` : '',
        c.team_info               ? `Team: ${c.team_info}` : '',
        c.trust_signals           ? `Trust: ${c.trust_signals}` : '',
        c.service_differentiators ? `Differentiators: ${c.service_differentiators}` : '',
        c.location_info           ? `Location: ${c.location_info}` : '',
        c.target_keywords         ? `Target keywords: ${c.target_keywords}` : '',
        c.schema_type             ? `Schema type: ${c.schema_type}` : '',
        c.competitors?.length     ? `Competitors: ${c.competitors.join(', ')}` : '',
        c.github_repo             ? `Repo: ${c.github_repo}` : '',
      ].filter(Boolean).join('\n')
      return fields
    }).join('\n\n')
    parts.push(`CLIENTS:\n${clientContext}`)

    if (clients.length > 1) {
      parts.push(`CLIENT DISAMBIGUATION:
If a request could apply to multiple clients and it is unclear which is intended, ask before proceeding: "Which client — ${clients.map(c => c.name).join(', ')}?"
If only one client exists, assume all work is for that client.
General questions (how does X work, what is Y) can be answered without specifying a client.`)
    }
  }

  // Knowledge panel injection — cached intelligence, no tool call cost
  const knowledgeBlocks = clients.map(c => {
    const k = knowledgePanels[c.id]
    if (!k) return null
    const kParts = [`KNOWLEDGE PANEL — ${c.name}:`]

    if (k.site_summary) kParts.push(`Site overview: ${k.site_summary}`)

    if (k.site_pages?.length > 0) {
      const synced = k.site_pages_updated_at ? new Date(k.site_pages_updated_at).toLocaleDateString('en-GB') : 'unknown'
      const pageList = k.site_pages.map((p: any) =>
        `${p.url}${p.title ? ` — "${p.title}"` : ''}${p.word_count ? ` (${p.word_count}w)` : ''}`
      ).join('\n')
      kParts.push(`Live pages — ${k.site_pages.length} total, last crawled ${synced}:\n${pageList}`)
    }

    if (k.gsc_snapshot?.totals) {
      const { clicks, impressions, avg_position } = k.gsc_snapshot.totals
      const synced = k.gsc_snapshot_updated_at ? new Date(k.gsc_snapshot_updated_at).toLocaleDateString('en-GB') : 'unknown'
      kParts.push(`GSC snapshot (${synced}): ${(clicks || 0).toLocaleString()} clicks, ${(impressions || 0).toLocaleString()} impressions, avg pos ${avg_position ?? 'n/a'}`)
      if (k.gsc_snapshot.near_miss?.length) {
        kParts.push(`Near-miss: ${k.gsc_snapshot.near_miss.slice(0, 10).map((r: any) => `"${r.query}" #${Math.round(r.position)} (${r.impressions}imp)`).join(' | ')}`)
      }
      if (k.gsc_snapshot.low_ctr?.length) {
        kParts.push(`Low CTR on page 1: ${k.gsc_snapshot.low_ctr.slice(0, 5).map((r: any) => `${r.url} ${(r.ctr * 100).toFixed(1)}%`).join(' | ')}`)
      }
    }

    if (k.content_summary) kParts.push(`Content state: ${k.content_summary}`)
    if (k.docs?.length) {
      const filteredDocs = (k.docs as any[]).filter((d: any) => d.content?.trim())
      if (filteredDocs.length > 0) {
        const docsText = filteredDocs.map((d: any) => `### ${d.title}\n${d.content}`).join('\n\n')
        kParts.push(`KNOWLEDGE DOCUMENTS — read and apply these on every response:\n${docsText}`)
      }
    }
    const agentSlug = agent.slug || agent.name?.toLowerCase() || 'ada'
    const agentNotes = k.agent_notes?.[agentSlug]
    if (agentNotes) {
      const noteParts: string[] = []
      if (typeof agentNotes === 'string') {
        noteParts.push(agentNotes)
      } else {
        if (agentNotes.last_conversation?.summary) noteParts.push(`Last session: ${agentNotes.last_conversation.summary}`)
        if (agentNotes.last_conversation?.recommendations?.length) noteParts.push(`Recommendations pending: ${agentNotes.last_conversation.recommendations.join('; ')}`)
        if (agentNotes.last_conversation?.pending?.length) noteParts.push(`Outstanding items: ${agentNotes.last_conversation.pending.join('; ')}`)
        if (agentNotes.history?.length > 1) noteParts.push(`Previous sessions: ${(agentNotes.history as any[]).slice(-3).map((h: any) => h.summary).filter(Boolean).join(' | ')}`)
      }
      if (noteParts.length > 0) kParts.push(`Your notes on this client:\n${noteParts.join('\n')}`)
    }

    if (k.agent_notes?.competitor_analysis) {
      const ca = k.agent_notes.competitor_analysis
      const ageHours = (Date.now() - new Date(ca.updated_at).getTime()) / 3600000
      if (ageHours < 168) {
        kParts.push(`COMPETITOR ANALYSIS (from ${Math.round(ageHours)}h ago):\n${ca.result}`)
      }
    }

    return kParts.join('\n\n')
  }).filter(Boolean)

  if (knowledgeBlocks.length > 0) {
    parts.push(knowledgeBlocks.join('\n\n---\n\n'))
    parts.push(`IMPORTANT: The knowledge panel above is your ground truth for site structure and recent performance. Use it before calling get_site_pages or analyse_gsc — only call those tools if you need fresher data than the panel provides, or for a specific query the panel cannot answer.`)
  }

  const isSeo       = agent.agent_type === 'seo'
  const isTechnical = agent.agent_type === 'technical'

  if (isSeo) {
    parts.push(`SEO WORKING APPROACH:
You are a proactive SEO strategist. Investigate before advising. You have a full tool set — call whatever you need.

Tool usage guide:
- Knowledge panel (above): use first for site structure, pages, GSC snapshot. Already loaded, no cost.
- analyse_gsc: call when you need fresher data than the snapshot, or a deeper breakdown
- get_site_pages: call when you need pages the knowledge panel does not have, or to filter by specific criteria
- search_history: call before writing anything to avoid repeating angles and find linking opportunities
- get_keywords: call to see the full keyword bank with targets and current ranking positions
- audit_site: call when doing a full site health review
- analyse_competitors: call when evaluating content gaps against competitors
- startup_seo_brief: call when a site is new, has no/low GSC history, has a thin keyword bank, or the user asks how to grow a startup from scratch
- read_page: call when you need the full content of a specific page before writing something adjacent
- generate_images: call after writing the draft, not before
- write_content: call to save finished drafts for review
- save_planned_task / update_planned_task: call to log agreed content to the scheduler
- suggest_internal_links: call after every write_content
- suggest_keyword: call when you spot a valuable keyword not in the bank
- web_search: use for current information — what's ranking for a keyword right now, recent algorithm changes, competitor content, industry trends, or any question where training data may be outdated. Search before answering questions about current best practices.

DATA ACCURACY RULE:
Before claiming any keyword is "untargeted" or any topic "has not been covered," cross-reference all three:
1. The keyword bank (get_keywords) — does any keyword have content_targeting_this set?
2. The knowledge panel site pages — is there a live page on this topic?
3. search_history — has a draft or published piece covered this angle?
All three must agree before you say something is a gap. If they conflict, read the relevant page before concluding.
If get_keywords reports "inferred coverage" for a keyword, treat it as already targeted unless the user explicitly asks for a stronger/dedicated page.

STARTUP / NO-GSC RULE:
Google Search Console is useful but optional. If a client is new, has no GSC rows, has not connected GSC, or has too little historical search data, do not stop or tell the user to wait for GSC. Switch to startup SEO mode: use startup_seo_brief, the client profile, services, locations, site pages, keyword bank, competitor URLs/pages, and web_search/SERP research to build a seed keyword strategy. Be clear when volume/difficulty is estimated, then use suggest_keyword for valuable seed opportunities that are missing from the bank.

BLOG POST WORKFLOW:
1. search_history — check what exists on this topic
2. get_keywords — find the best keyword angle not already covered
3. Knowledge panel site pages — identify internal linking opportunities (no tool call needed if panel is loaded)
4. Write the complete markdown post
5. generate_images — after writing, derive 2-3 prompts from the actual content
6. write_content — save the draft with images
7. suggest_internal_links — identify pages that should link to this new piece

Call steps 1 and 2 in parallel in a single response. Do not call them sequentially.

BLOG POST RULES:
- Title tag: ~60 chars, lead with keyword, end on differentiator
- Meta description: ~155 chars, keyword + value prop + location if local
- Primary keyword in: H1, first 100 words, at least one H2, title tag, meta description
- Location terms in first 100 words for local content
- Real URLs only for internal links — use knowledge panel pages. Flag missing pages as [NEEDS PAGE: /slug]
- Prose over bullets — max 3 bullet lists per post
- FAQ sections need JSON-LD schema block appended
- Named credentialed practitioner for health, legal, or regulated content
- 2-4 images per post, placed naturally

CONTENT FORMAT — always markdown with YAML frontmatter:
---
title: "Post Title"
slug: "post-slug"
description: "Meta description 150-160 chars"
keyword: "primary keyword"
category: "Category"
reading_time: "X min read"
date: "YYYY-MM-DD"
---

Use ## for H2, ### for H3. Standard markdown links. Bold sparingly. > for callouts.
Never write TypeScript, JSX, or code.

CONTENT PLANNING:
Default to 3 posts per week unless keyword bank is shallow or user specifies otherwise.
Sequence: fastest ranking wins first (KD <30, near-miss), then hub pages, then commercial intent, then informational.
A 4-week plan = 10-14 pieces, not 4.
If keyword bank is thin, use startup_seo_brief plus web_search to create seed commercial/local/informational opportunities. Do not pad with low-value topics.

PROACTIVE RESPONSIBILITIES:
- After publishing, call suggest_internal_links
- Spot keyword gaps and cannibalisation unprompted — raise them when relevant
- If the GSC snapshot is more than 48 hours old, mention it and offer to refresh`)
  }

  if (isSeo && digest) {
    parts.push(`CURRENT SEO INTELLIGENCE (week of ${digest.week_of}):\n${digest.summary}\n\nApply this current knowledge when making recommendations. If something here contradicts older best practices you know, the current information takes precedence.`)
  }

  if (isTechnical) {
    parts.push(`PUBLISHING:
Use publish_content with the output_id to publish approved drafts. Always confirm the draft is approved first. Report the live URL when done.`)
  }

  parts.push(`IMAGE GENERATION:
Always use generate_images in a single call with an array — never separate calls per image.
Generate images AFTER writing the content, not before. Prompts must be derived from the actual post content.
- Only call generate_images for NEW content, never for revisions
- If the user asks you to revise, edit, expand or rewrite existing content, always set is_revision: true in write_content and skip generate_images entirely
- If is_revision is true in your write_content call, do NOT call generate_images — proceed directly to suggest_internal_links

Use the SCHEMA methodology for every prompt (Structured Components for Harmonized Engineered Modular Architecture):
- SUBJECT: Who or what is the main focus. Specific — not "a person" but "a woman in her 60s seated in a living room armchair"
- CONTEXT: The environment, setting, and spatial relationships. Real locations, not abstract or studio backgrounds.
- LIGHTING: Specific light quality. Use Kelvin temperature or descriptive terms (4500K overcast window light, warm afternoon sun through net curtains).
- ATMOSPHERE: The emotional register and mood. What does it feel like to be in this image?
- CAMERA: Focal length and shooting style (35mm documentary, 85mm portrait, wide editorial).
- STYLE: Photographic reference (Guardian Weekend editorial, BBC lifestyle documentary, Magnum street).
- MANDATORY: Non-negotiable elements that must appear.
- PROHIBITIONS: What must not appear. Be explicit.

Derive every element from the post content:
- The client's location, audience, and brand voice inform the setting and people
- The topic of the post determines what the image should show
- The client's ICP determines who appears in the image
- Never use generic prompts — every prompt must be specific to this post for this client

Image quality requirements:
- Photorealistic, natural and candid, never posed or stock-feeling
- Contextually accurate to the client's geography and audience
- Keyword-rich filename in kebab-case
- Accurate alt text describing exactly what is shown, including the primary keyword naturally

Resolution defaults to 1K (1024x1024) — sufficient quality for standard blog images, significantly cheaper than 2K/4K. Only request higher resolution for hero campaign images or print assets.`)

  parts.push(`RESPONSE STYLE:
Write conversationally. Lead with the most important thing, not a preamble.
- Use ## headings only for genuinely distinct sections in longer analyses — not for replies under 200 words
- Bullets for genuinely list-like content. Prose for reasoning.
- Bold sparingly — one key term or finding per section at most
- Never start with "Certainly", "Great question", "Of course", or any filler
- End with one clear question or action — not a list of options
- UK English. No em dashes.

LENGTH:
- Conversational replies: 2-4 sentences
- Single keyword or page analysis: 150-300 words
- Full strategy or content plan: up to 500 words
- Never produce walls of text for a question with a direct answer

SUGGESTED REPLIES:
When your response ends with a question or offers the user options, always include a SUGGESTIONS block at the very end in this exact format:

<suggestions>
["Option one text", "Option two text", "Option three text"]
</suggestions>

Use this when the task is broad, when you are asking for clarification, or when there are 2-3 natural next steps. Do not use it after completing a specific task the user explicitly requested. Options should be short (under 10 words each) and immediately actionable.

ACKNOWLEDGEMENT:
When starting a task that will take multiple tool calls or produce substantial output, send a brief acknowledgement first in plain prose (1 sentence), then begin working. Example: "On it — pulling keyword data and content history now." Do not send the acknowledgement and the results in the same message turn.`)

  return parts.join('\n\n')
}

const ALL_TOOLS = [
  {
    name: 'write_content',
    description: `Save a completed piece of content as a draft for review.

Content must be in markdown format with YAML frontmatter.
Images should be referenced using their Supabase Storage URLs from generate_images.
This saves the content as a draft. A human will review it before it is published.

Required frontmatter fields:
- title: the post title
- slug: URL-friendly slug (kebab-case)
- description: meta description (150-160 chars)
- keyword: primary target keyword
- category: content category
- reading_time: estimated reading time e.g. "8 min read"
- date: publish date YYYY-MM-DD`,
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string' },
        content: { type: 'string', description: 'Full markdown content including YAML frontmatter' },
        images: {
          type: 'array',
          description: 'Images generated for this post',
          items: { type: 'object', properties: {
            url: { type: 'string' }, alt_text: { type: 'string' },
            filename: { type: 'string' }, storage_path: { type: 'string' }
          } }
        },
        title: { type: 'string' },
        slug: { type: 'string' },
        primary_keyword: { type: 'string' },
        meta_description: { type: 'string' },
        word_count: { type: 'number' },
        is_revision: {
          type: 'boolean',
          description: 'Set to true if this is a revision of existing content, not a new draft. When true, images will NOT be generated automatically.',
        },
      },
      required: ['client_name', 'content', 'title', 'slug', 'primary_keyword']
    },
  },
  {
    name: 'publish_content',
    description: `Publish an approved content draft to the client's website.

Reads the approved content_outputs record, converts to the platform format,
and publishes via the appropriate API or file commit.

Supports: wordpress, shopify, github (MDX), webflow`,
    input_schema: {
      type: 'object',
      properties: {
        output_id: { type: 'string', description: 'The content_outputs ID to publish' },
        client_name: { type: 'string' },
        platform_override: { type: 'string', enum: ['wordpress', 'shopify', 'github', 'webflow'], description: 'Override the platform if needed. Otherwise reads from site_connections' }
      },
      required: ['output_id', 'client_name']
    },
  },
  {
    name: 'generate_images',
    description: 'Generate multiple images in parallel using Nano Banana Pro AI and upload them to Supabase Storage. Returns an array of public URLs to reference in the markdown post. Use the SCHEMA methodology for every prompt (Structured Components for Harmonized Engineered Modular Architecture): Subject, Context, Harmony, Environment, Mood, Aesthetics. Derive prompts from the actual written content -- never generate before writing. Resolution defaults to 1K (1024x1024) -- sufficient for blog images. Only request 2K or 4K for hero/campaign images. Always pass all images in one call.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client name, e.g. "Acme Corp"' },
        images: {
          type: 'array',
          description: 'Array of images to generate (max 4)',
          items: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'Detailed image generation prompt. Warm, professional, photorealistic, natural soft lighting, real environments. No stock-photo feel.' },
              alt_text: { type: 'string', description: 'Descriptive alt text for the image.' },
              filename: { type: 'string', description: 'Short kebab-case slug without extension, e.g. "private-audiologist-north-east". Will be prefixed with "blog-" automatically.' },
            },
            required: ['prompt', 'alt_text', 'filename'],
          },
        },
      },
      required: ['client_name', 'images'],
    },
  },
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
    description: 'Read the content of a specific file from the client codebase on GitHub. Use this to inspect existing files before referencing or changing anything. The full parameter is a no-op and can be omitted.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client whose repo to read from' },
        file_path: { type: 'string', description: 'The file path relative to repo root, e.g. src/app/page.tsx or content/blog/my-post.mdx' },
        full: { type: 'boolean', description: 'Set to true to return the complete file content without any trimming. Default false.' },
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
      required: ['client_name'],
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
  {
    name: 'get_site_pages',
    description: 'Get crawled pages for a client site. Use this to find real URLs for internal links. Always pass keyword (the primary keyword you are writing about) — this returns the 10 most relevant pages plus any stubs, keeping context lean. Omit keyword only when auditing the full site structure.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string' },
        keyword: { type: 'string', description: 'The primary keyword you are writing about, e.g. "ear wax removal Newcastle". When provided, returns the top 10 most relevant pages plus any stubs instead of all 100 pages — keeps context lean.' },
        filter: { type: 'string', enum: ['all', 'no_meta', 'no_h1', 'thin'], description: 'all = every page, no_meta = missing meta, no_h1 = missing H1, thin = under 300 words' },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'get_keywords',
    description: 'Fetch the full keyword bank for a client. Returns all keywords with their intent, funnel stage, monthly volume, difficulty, current ranking position, and any existing content targeting them. Call this when planning content strategy, identifying gaps, or deciding what to write next.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client' },
        filter: { type: 'string', enum: ['all', 'untargeted', 'ranking', 'high_volume'], description: 'all = full list, untargeted = no content yet, ranking = currently ranking, high_volume = 1000+ monthly searches' },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'suggest_keyword',
    description: 'Propose a new keyword for a client to be reviewed and approved in the Agencee /keywords page. Use this when you identify a valuable keyword opportunity that is not yet in the client\'s keyword bank.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client to suggest the keyword for' },
        keyword: { type: 'string', description: 'The keyword to suggest' },
        rationale: { type: 'string', description: 'Why this keyword is valuable — what gap it fills, what intent it serves' },
        monthly_volume_estimate: { type: 'number', description: 'Estimated monthly search volume' },
        difficulty_estimate: { type: 'number', description: 'Estimated keyword difficulty (0-100)' },
        intent: { type: 'string', enum: ['informational', 'commercial', 'transactional', 'navigational'] },
        funnel_stage: { type: 'string', enum: ['tofu', 'mofu', 'bofu'] },
        cluster: { type: 'string', description: 'The topic cluster this keyword belongs to' },
      },
      required: ['client_name', 'keyword', 'rationale'],
    },
  },
  {
    name: 'create_content_plan',
    description: 'Create a content calendar plan for a client. Adds multiple planned pieces to the content calendar which the user can then review, queue, and track.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client to build the plan for' },
        entries: {
          type: 'array',
          description: 'Array of content pieces to plan',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Working title for the piece' },
              primary_keyword: { type: 'string', description: 'Target keyword' },
              content_type: { type: 'string', enum: ['blog_post', 'pillar_page', 'category_page', 'local_seo'] },
              scheduled_date: { type: 'string', description: 'ISO date string (YYYY-MM-DD) for when to publish' },
              notes: { type: 'string', description: 'Brief notes on the angle or approach' },
            },
            required: ['title'],
          },
        },
      },
      required: ['client_name', 'entries'],
    },
  },
  {
    name: 'analyse_competitors',
    description: 'Retrieve and analyse crawled competitor data for a client. Returns a summary of what competitors cover, their top pages, and content patterns. Use this to identify content gaps and opportunities before planning new content.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client to analyse competitors for' },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'startup_seo_brief',
    description: 'Build a seed SEO brief for a new or low-history client without relying on Google Search Console. Returns profile context, services/locations/target keywords, live pages, keyword bank coverage, content history, competitor URLs/pages, and clear instructions for startup keyword and content strategy.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client to brief' },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'suggest_internal_links',
    description: 'After saving new content, identify existing pages that should link to it. Call this after every successful write_content.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string' },
        new_page_url: { type: 'string' },
        new_page_keyword: { type: 'string' },
        new_page_title: { type: 'string' },
      },
      required: ['client_name', 'new_page_url', 'new_page_keyword', 'new_page_title'],
    },
  },
  {
    name: 'analyse_gsc',
    description: 'Analyse Google Search Console data for a client. Returns near-miss keywords (ranking 5-15 with good impressions), declining pages, top performing queries, and specific content opportunities. Call this at the start of any conversation to understand the current SEO performance landscape before making recommendations.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client to analyse' },
        period: { type: 'string', enum: ['7d', '28d', '90d'], description: 'Time period to analyse. Use 28d for most analyses.' },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'update_agent_notes',
    description: `Save persistent notes about a client to your knowledge panel. These notes survive across conversations and sessions -- use them to record things worth remembering: tone preferences, topics to avoid, recurring issues, successful content patterns, things the user has asked you to keep in mind. Call this at the end of any conversation where you learned something useful about the client or their preferences.`,
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client these notes are about' },
        notes: { type: 'string', description: 'The notes to save. These replace your existing notes for this client, so include anything worth keeping from before.' },
      },
      required: ['client_name', 'notes'],
    },
  },
]

function getToolsForAgent(agentType: string) {
  const customTools = ALL_TOOLS

  // Add native Anthropic web search for SEO agents
  if (agentType !== 'technical') {
    return [
      ...customTools,
      { type: 'web_search_20250305', name: 'web_search' } as any,
    ]
  }
  return customTools
}

const S = {
  btn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '9px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  btnSm: { background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  label: { fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: 4, display: 'block' } as React.CSSProperties,
  hint: { fontSize: 12, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.4 } as React.CSSProperties,
  field: { marginBottom: 24 } as React.CSSProperties,
  sectionHead: { fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)' } as React.CSSProperties,
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

function parseSuggestions(content: string): { clean: string; suggestions: string[] } {
  const match = content.match(/<suggestions>\s*(\[[\s\S]*?\])\s*<\/suggestions>/)
  if (!match) return { clean: content, suggestions: [] }
  try {
    const suggestions = JSON.parse(match[1])
    const clean = content.replace(/<suggestions>[\s\S]*?<\/suggestions>/, '').trim()
    return { clean, suggestions: Array.isArray(suggestions) ? suggestions : [] }
  } catch {
    return { clean: content, suggestions: [] }
  }
}

function stripToolCallJson(content: string): string {
  let clean = content || ''
  clean = clean.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (block, body) =>
    /["']tool_name["']|["']parameters["']/.test(body) ? '' : block
  )
  clean = clean.replace(/(^|\n)\s*(\[\s*\{[\s\S]*?["']tool_name["'][\s\S]*?\}\s*\])\s*(?=\n|$)/gi, '$1')
  clean = clean.replace(/(^|\n)\s*(\{\s*["']tool_name["'][\s\S]*?\})\s*(?=\n|$)/gi, '$1')
  if (/^\s*[\[{][\s\S]*["']tool_name["'][\s\S]*[\]}]\s*$/.test(clean)) return ''
  return clean.replace(/\n{3,}/g, '\n\n').trim()
}

function toolClientName(input: any): string {
  return input?.client_name || input?.client || input?.clientName || ''
}

function normaliseForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\baudiology\b/g, 'audiolog')
    .replace(/\baudiologist\b/g, 'audiolog')
    .replace(/\bhearing aids\b/g, 'hearing aid')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function keywordTerms(keyword: string): string[] {
  const stop = new Set(['the', 'and', 'for', 'with', 'near', 'me', 'at', 'to', 'in', 'a', 'an'])
  return normaliseForMatch(keyword).split(/\s+/).filter(w => w.length > 1 && !stop.has(w))
}

function pageCoversKeyword(page: SitePage, keyword: string): boolean {
  const haystack = normaliseForMatch([page.url, page.title, page.h1, page.meta_description, page.content_summary].filter(Boolean).join(' '))
  const phrase = normaliseForMatch(keyword)
  if (phrase && haystack.includes(phrase)) return true
  const terms = keywordTerms(keyword)
  return terms.length > 0 && terms.every(term => haystack.includes(term))
}

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
  const [agentStatus, setAgentStatus] = useState<string | null>(null)
  const [taskLog, setTaskLog] = useState<TaskEntry[]>([])
  const [thoughts, setThoughts] = useState<string[]>([])
  const autoSendRef = useRef(false)
  const taskLogRef = useRef<TaskEntry[]>([])
  const thoughtsRef = useRef<string[]>([])
  const [settings, setSettings] = useState<Partial<Agent>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [gscRows, setGscRows] = useState<Record<string, GscRow[]>>({})
  const [knowledgePanels, setKnowledgePanels] = useState<Record<string, any>>({})
  const [latestDigest, setLatestDigest] = useState<{ summary: string; week_of: string } | null>(null)
  const [sessionTokens, setSessionTokens] = useState(0)
  const [sessionCost, setSessionCost] = useState(0)
  const sessionTokensRef = useRef(0)
  const draftSavedRef = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)

  // Map tool names → human-readable status labels
  const TOOL_STATUS: Record<string, string> = {
    audit_site: 'Auditing site…',
    get_site_pages: 'Loading site pages…',
    search_history: 'Checking content history…',
    save_planned_task: 'Saving task to queue…',
    update_planned_task: 'Updating planned task…',
    write_file: 'Writing to GitHub…',
    read_file: 'Reading file from repo…',
    read_page: 'Reading live page…',
    generate_images: 'Generating images with Nano Banana…',
    get_keywords: 'Loading keyword bank…',
    write_content: 'Saving draft…',
    publish_content: 'Publishing…',
    suggest_keyword: 'Saving keyword suggestion…',
    create_content_plan: 'Building content calendar…',
    analyse_competitors: 'Analysing competitor sites…',
    startup_seo_brief: 'Building startup SEO brief…',
    suggest_internal_links: 'Finding internal link opportunities…',
    analyse_gsc: 'Analysing Search Console data…',
    web_search: 'Searching the web…',
  }

  useEffect(() => {
    if (!id) return
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null
      setUserId(uid)
      if (uid) {
        const { data: ws } = await supabase.from('workspaces').select('id').eq('owner_id', uid).maybeSingle()
        if (ws) setWorkspaceId(ws.id)
      }
    })
    loadAgent(); loadClients(); loadConversations(); loadPlannedTasks(); loadDigest()
    const params = new URLSearchParams(window.location.search)
    const convParam = params.get('conversation')
      || localStorage.getItem(`agencee_last_conv_${id}`)
    if (convParam) loadMessages(convParam)
    const prefill = params.get('draft')
    const autoSend = params.get('send') === '1'
    const brief = params.get('brief')
    const briefPos = params.get('position')
    const briefImpressions = params.get('impressions')
    if (brief) {
      const msg = `I want to push "${decodeURIComponent(brief)}" from position ${briefPos || '?'} to page 1. It's currently getting ${briefImpressions || '?'} impressions. Analyse this keyword and recommend a content approach.`
      setDraft(msg)
      autoSendRef.current = true
    } else if (prefill) {
      setDraft(decodeURIComponent(prefill))
      if (autoSend) autoSendRef.current = true
    }
  }, [id])

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [messages])

  // Auto-send when ?send=1 — fires once agent and clients are loaded
  useEffect(() => {
    if (autoSendRef.current && agent && clients.length > 0 && draft.trim() && !sending) {
      autoSendRef.current = false
      send()
    }
  }, [agent, clients])

  async function loadDigest() {
    const { data } = await supabase
      .from('agent_knowledge')
      .select('summary, week_of')
      .eq('agent_type', 'seo')
      .order('week_of', { ascending: false })
      .limit(1)
      .maybeSingle()
    setLatestDigest(data || null)
  }

  async function loadAgent() {
    const { data } = await supabase.from('agents').select('*').eq('id', id).single()
    if (data) { setAgent(data); setSettings(data) }
  }

  async function loadClients() {
    const { data } = await supabase.from('client_profiles').select('id,name,description,icp,usp,brand_voice,content_goals,competitors,file_tree,github_repo,slug,industry,website,pricing_info,team_info,trust_signals,service_differentiators,location_info,target_keywords,content_tone,avoid_topics,cta_approach,schema_type').order('name')
    const clientList = data || []
    setClients(clientList)
    loadSitePages(clientList)
    loadGscData(clientList)
    loadKnowledgePanels(clientList)
  }

  async function loadKnowledgePanels(clientList: Client[]) {
    const panels: Record<string, any> = {}
    await Promise.all(clientList.map(async c => {
      try {
        const res = await fetch(`/api/knowledge/${c.id}`)
        const { knowledge } = await res.json()
        if (knowledge) panels[c.id] = knowledge

        const now = Date.now()
        const sevenDays = 7 * 24 * 60 * 60 * 1000
        const twoDays = 48 * 60 * 60 * 1000

        const needsCrawlBackfill = !knowledge ||
          !knowledge.site_pages_updated_at ||
          (now - new Date(knowledge.site_pages_updated_at).getTime()) > sevenDays

        if (needsCrawlBackfill && c.website) {
          fetch('/api/crawl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ website: c.website, client_id: c.id }),
          }).catch(() => {})
        }

        const needsGscBackfill = !knowledge?.gsc_snapshot_updated_at ||
          (now - new Date(knowledge.gsc_snapshot_updated_at).getTime()) > twoDays

        if (needsGscBackfill) {
          fetch('/api/gsc/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: c.id }),
          }).catch(() => {})
        }
      } catch { /* non-critical */ }
    }))
    setKnowledgePanels(panels)
  }

  async function loadGscData(clientList: Client[]) {
    const gsc: Record<string, GscRow[]> = {}
    for (const c of clientList) {
      const { data } = await supabase.from('search_performance')
        .select('query,page,position,impressions,clicks,ctr,period_start,period_end')
        .eq('client_id', c.id)
        .not('query', 'in', '("__total__","__page__","__device__")')
        .order('impressions', { ascending: false })
        .limit(200)
      if (data && data.length > 0) gsc[c.id] = data
    }
    setGscRows(gsc)
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
    let uid = userId
    if (!uid) {
      const { data: authData } = await supabase.auth.getUser()
      uid = authData.user?.id ?? null
      if (uid) setUserId(uid)
    }
    setSessionTokens(0); setSessionCost(0); sessionTokensRef.current = 0
    localStorage.removeItem(`agencee_last_conv_${id}`)
    const { data } = await supabase.from('conversations').insert({ agent_id: id, title: 'New conversation', user_id: uid }).select().single()
    if (data) { setConversations(prev => [data, ...prev]); setActiveConv(data.id); setMessages([]) }
  }

  async function deleteConversation(convId: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Delete this conversation? This cannot be undone.')) return
    await supabase.from('messages').delete().eq('conversation_id', convId)
    await supabase.from('conversations').delete().eq('id', convId)
    setConversations(prev => prev.filter(c => c.id !== convId))
    if (activeConv === convId) { setActiveConv(null); setMessages([]) }
  }

  async function loadMessages(convId: string) {
    setActiveConv(convId)
    localStorage.setItem(`agencee_last_conv_${id}`, convId)
    const url = new URL(window.location.href)
    url.searchParams.set('conversation', convId)
    window.history.replaceState(null, '', url.toString())
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at')
    const parsed = (data || []).map((m: any) => {
      if (m.role !== 'assistant') return m
      const { content, taskLog, thoughts } = decodeMessageMeta(m.content || '')
      return { ...m, content: stripToolCallJson(content), _taskLog: taskLog, _thoughts: thoughts.map(stripToolCallJson).filter(Boolean) }
    })
    setMessages(parsed)
    // Restore task log from the last assistant message that used tools
    const lastWithTasks = [...parsed].reverse().find(m => m.role === 'assistant' && m._taskLog?.length > 0)
    setTaskLog(lastWithTasks?._taskLog || [])
    taskLogRef.current = lastWithTasks?._taskLog || []
  }

  // Holds the card data for a draft saved by write_content during the current
  // agentic loop — attached to the assistant message when the reply is saved.
  const pendingDraftCardRef = useRef<DraftCard | null>(null)
  const tokenAccumRef = useRef(0)

  async function handleToolCall(toolName: string, toolInput: any, convId: string): Promise<string> {
    // ── write_content: save a markdown draft to content_outputs (Ada) ──────────
    if (toolName === 'write_content') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return JSON.stringify({ success: false, error: `Could not find client matching "${toolInput.client_name}".` })
      try {
        const cleaned = cleanContent(toolInput.content || '')
        const wordCount = toolInput.word_count || cleaned.split(/\s+/).filter(Boolean).length
        let uid = userId
        if (!uid) { const { data: authData } = await supabase.auth.getUser(); uid = authData.user?.id ?? null }

        // Prevent duplicate saves — check for same keyword + client in last 30 mins
        const { data: existing } = await supabase
          .from('content_outputs')
          .select('id')
          .eq('client_id', client.id)
          .ilike('primary_keyword', toolInput.primary_keyword)
          .eq('approved', false)
          .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
          .maybeSingle()

        if (existing) {
          draftSavedRef.current = true
          return JSON.stringify({
            success: true,
            output_id: existing.id,
            message: 'Draft already saved — do not call write_content again. Review at /outputs/' + existing.id + '. Now call suggest_internal_links.',
            review_url: '/outputs/' + existing.id,
            already_existed: true,
          })
        }

        const { data: output, error: outputError } = await supabase.from('content_outputs').insert({
          workspace_id: workspaceId,
          client_id: client.id,
          user_id: uid,
          agent_type: 'seo',
          title: toolInput.title,
          content: cleaned,
          primary_keyword: toolInput.primary_keyword,
          meta_description: toolInput.meta_description || '',
          word_count: wordCount,
          approved: false,
          source: 'chat',
          format: 'markdown',
          images: toolInput.images || [],
          notes: 'Draft created by Ada. Awaiting review.',
        }).select().single()

        if (outputError || !output) {
          return JSON.stringify({ success: false, error: 'Failed to save draft.' })
        }

        fetch('/api/agent-activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: id, client_id: client.id, action: 'content_created', detail: { output_id: output.id, title: toolInput.title, slug: toolInput.slug, primary_keyword: toolInput.primary_keyword }, tokens_used: tokenAccumRef.current }),
        }).catch((err: any) => console.error('[write_content] agent-activity log failed:', err?.message))

        // Mark keyword as targeted — draft URL, overwritten with live URL on publish
        if (toolInput.primary_keyword && client.id && output?.id) {
          void supabase
            .from('keyword_banks')
            .update({ content_targeting_this: `/outputs/${output.id}` })
            .eq('client_id', client.id)
            .ilike('keyword', toolInput.primary_keyword)
        }

        if (workspaceId) {
          fetch('/api/notifications/output-ready', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workspace_id: workspaceId,
              output_id: output.id,
              title: toolInput.title,
              client_name: client.name,
              primary_keyword: toolInput.primary_keyword,
              word_count: wordCount,
            }),
          }).catch((err: any) => console.error('[write_content] output-ready notification failed:', err?.message))
        }

        pendingDraftCardRef.current = {
          title: toolInput.title,
          word_count: wordCount,
          image_count: (toolInput.images || []).length,
          review_url: `/outputs/${output.id}`,
        }
        draftSavedRef.current = true

        if (toolInput.is_revision) {
          return JSON.stringify({
            success: true,
            output_id: output.id,
            message: 'Revised draft saved at /outputs/' + output.id + '. Do NOT call generate_images — this is a revision. Call suggest_internal_links instead.',
            review_url: '/outputs/' + output.id,
            is_revision: true,
          })
        }

        return JSON.stringify({ success: true, output_id: output.id, message: 'Draft saved successfully. Title: "' + toolInput.title + '". It is now in your Outputs queue for review at /outputs/' + output.id + '.', review_url: '/outputs/' + output.id })
      } catch (e: any) { return JSON.stringify({ success: false, error: e?.message || 'Failed to save draft.' }) }
    }

    // ── publish_content: publish an approved draft to the client site (Theo) ───
    if (toolName === 'publish_content') {
      try {
        const { data: output } = await supabase.from('content_outputs').select('*').eq('id', toolInput.output_id).single()
        if (!output) return JSON.stringify({ success: false, error: 'Output not found' })
        if (!output.approved) return JSON.stringify({ success: false, error: 'Output is not approved. Ask the user to approve it first.' })

        const { data: connection } = await supabase.from('site_connections').select('*').eq('client_id', output.client_id).limit(1).maybeSingle()
        const platform = toolInput.platform_override || connection?.platform
        if (!platform) return JSON.stringify({ success: false, error: 'No platform configured for this client. Add a site connection first.' })

        const publishRes = await fetch('/api/connections/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ output_id: toolInput.output_id, connection_id: connection?.id }),
        })
        const publishData = await publishRes.json()
        if (!publishRes.ok || !publishData.success) {
          return JSON.stringify({ success: false, error: publishData.error || 'Publishing failed.' })
        }
        return JSON.stringify({ success: true, platform, published_url: publishData.published_url, message: 'Published successfully to ' + platform + '. Live at: ' + publishData.published_url })
      } catch (e: any) { return JSON.stringify({ success: false, error: e?.message || 'Publishing failed.' }) }
    }

    // ── generate_images: parallel image generation → Supabase Storage ──────────
    if (toolName === 'generate_images') {
      const currentClient = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      const clientStyleContext = currentClient ? [
        `Setting: always a real home in ${currentClient.location_info || 'the UK'}, never a clinic.`,
        `Target audience: ${currentClient.icp ? currentClient.icp.slice(0, 200) : 'general public'}.`,
        `Brand feel: ${currentClient.content_tone || currentClient.brand_voice?.slice(0, 100) || 'professional and reassuring'}.`,
      ].join(' ') : ''
      const images: Array<{ prompt: string; alt_text: string; filename: string }> = toolInput.images || []
      if (!images.length) return JSON.stringify({ success: false, error: 'No images provided.' })
      const results = await Promise.all(images.map(async (img) => {
        try {
          const enhancedPrompt = clientStyleContext
            ? `${img.prompt}\n\nSTYLE REQUIREMENTS: ${clientStyleContext} Natural home environment, never clinical. Warm, documentary photography style. Natural lighting. Real, unstaged feel. No white coats or clinical equipment. High quality, editorial standard.`
            : img.prompt
          const res = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: enhancedPrompt, filename: img.filename, client_id: currentClient?.id || null, workspace_id: workspaceId }),
          })
          const data = await res.json()
          if (data.error) return { error: data.error, filename: img.filename }
          return { url: data.url, filename: data.filename, alt_text: img.alt_text, storage_path: data.storage_path }
        } catch { return { error: 'Generation failed.', filename: img.filename } }
      }))
      const successful = results.filter((r: any) => !r.error)
      const failed = results.filter((r: any) => r.error)
      return JSON.stringify({
        success: true,
        images: successful,
        failed: failed.length ? failed : undefined,
        message: `Generated ${successful.length} image(s)${failed.length ? `, ${failed.length} failed` : ''}. Reference each image in the markdown post using its url.`,
      })
    }

    if (toolName === 'save_planned_task') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Could not find client matching "${toolInput.client_name}".`
      const { data, error } = await supabase.from('planned_tasks').insert({
        agent_id: id, client_id: client.id, conversation_id: convId, user_id: userId ?? (await supabase.auth.getUser()).data.user?.id,
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
        const content: string = data.content

        // ── No trimming needed with the split-file structure ─────────────────────
        // blogContent.tsx is now a slim index (~80 lines). Returns in full — small.
        // Individual post files (blogPosts/[slug].tsx) are 300-500 lines each.
        // Reading any single post file is safe without trimming.
        // The `full` parameter is kept for backward compat but does nothing.

        return `File: ${toolInput.file_path}\n\n${content}`
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
      const requestedClient = toolClientName(toolInput)
      const client = clients.find(c => c.name.toLowerCase().includes(requestedClient.toLowerCase()))
      if (!client) return `Could not find client matching "${requestedClient}".`
      const { data } = await supabase.from('content_history').select('title,url,primary_keyword,summary,published_at,performance_notes,ranking_position,ranking_date,traffic_notes').eq('client_id', client.id).order('published_at', { ascending: false })
      if (!data || data.length === 0) return `No content history for ${client.name} yet — this client has no published pieces on record.`
      const query = (toolInput.query || '').toLowerCase()
      const list = query
        ? data.filter(h => (h.title || '').toLowerCase().includes(query) || (h.primary_keyword || '').toLowerCase().includes(query) || (h.summary || '').toLowerCase().includes(query))
        : data
      const header = query && list.length < data.length
        ? `${list.length} of ${data.length} pieces match "${toolInput.query}" for ${client.name}:`
        : `Full content history for ${client.name} (${data.length} pieces):`
      return header + '\n\n' + (list.length > 0 ? list : data).map(h =>
        `• "${h.title}" [${h.primary_keyword || 'no keyword'}]${h.url ? ` → ${h.url}` : ' (not published)'}\n  Published: ${h.published_at ? new Date(h.published_at).toLocaleDateString('en-GB') : 'unknown'} | Angle: ${h.summary || 'no summary'}${h.ranking_position ? ` | Ranking: #${h.ranking_position}` : ''}${h.ranking_date ? ` (as of ${new Date(h.ranking_date).toLocaleDateString('en-GB')})` : ''}${h.traffic_notes ? ` | Traffic: ${h.traffic_notes}` : ''}`
      ).join('\n')
    }

    if (toolName === 'get_site_pages') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Could not find client matching "${toolInput.client_name}".`
      const pages = sitePages[client.id] || []
      if (pages.length === 0) return `No crawled pages for ${client.name}. Run a site crawl first from the client profile.`
      let filtered = pages
      if (toolInput.filter === 'no_meta') filtered = pages.filter(p => !p.meta_description)
      else if (toolInput.filter === 'no_h1') filtered = pages.filter(p => !p.h1)
      else if (toolInput.filter === 'thin') filtered = pages.filter(p => p.word_count !== null && p.word_count < 300)
      // Keyword relevance filtering — when a keyword is supplied, return the top 10 scoring pages
      // plus any stubs (word_count = 0/null) worth linking to, instead of all 100 pages.
      // Scoring: count how many keyword words appear in the URL, title, H1, or content_summary.
      if (toolInput.keyword) {
        const words = (toolInput.keyword as string).toLowerCase().split(/\s+/).filter(Boolean)
        const scored = filtered.map(p => {
          const haystack = [p.url, p.title, p.h1, p.content_summary].filter(Boolean).join(' ').toLowerCase()
          const score = words.reduce((s: number, w: string) => s + (haystack.includes(w) ? 1 : 0), 0)
          return { page: p, score }
        })
        const stubs = scored.filter(({ page }) => !page.word_count || page.word_count === 0)
        const relevant = scored
          .filter(({ score, page }) => score > 0 && (page.word_count || 0) > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
        const relevantUrls = new Set(relevant.map(r => r.page.url))
        const merged = [...relevant, ...stubs.filter(s => !relevantUrls.has(s.page.url))]
        filtered = merged.map(({ page }) => page)
      }
      const filterLabel = toolInput.filter && toolInput.filter !== 'all' ? ` (filter: ${toolInput.filter})` : ''
      const kwLabel = toolInput.keyword ? ` | keyword: "${toolInput.keyword}"` : ''
      return `Site pages for ${client.name}${filterLabel}${kwLabel} — ${filtered.length} pages:\n\n` + filtered.map(p => {
        const meta = !p.meta_description ? ' [NO META]' : ''
        const h1 = p.h1 ? ` | H1: ${p.h1}` : ' [NO H1]'
        const words = p.word_count ? ` | ${p.word_count}w` : ''
        return `${p.url}${h1}${meta}${words}`
      }).join('\n')
    }

    if (toolName === 'get_keywords') {
      const requestedClient = toolClientName(toolInput)
      const client = clients.find(c => c.name.toLowerCase().includes(requestedClient.toLowerCase()))
      if (!client) return `Could not find client matching "${requestedClient}".`
      const { data } = await supabase.from('keyword_banks').select('keyword,intent,funnel_stage,monthly_volume,difficulty,current_position,content_targeting_this,cluster,priority,opportunity_score').eq('client_id', client.id).order('opportunity_score', { ascending: false, nullsFirst: false }).limit(200)
      if (!data || data.length === 0) return `No keywords in bank for ${client.name}. Add some in the Keywords section.`
      const pages = sitePages[client.id] || []
      const inferCoverage = (keyword: string): { url: string; reason: string } | null => {
        const matchedPage = pages.find(page => pageCoversKeyword(page, keyword))
        if (matchedPage) return { url: matchedPage.url, reason: 'inferred from crawled page title/H1/meta/summary' }
        return null
      }
      const targetingFor = (k: any): { value: string | null; inferred: boolean; reason?: string } => {
        if (k.content_targeting_this) return { value: k.content_targeting_this, inferred: false }
        const coverage = inferCoverage(k.keyword)
        return coverage ? { value: coverage.url, inferred: true, reason: coverage.reason } : { value: null, inferred: false }
      }
      let filtered = data
      if (toolInput.filter === 'untargeted') filtered = data.filter(k => !targetingFor(k).value)
      else if (toolInput.filter === 'ranking') filtered = data.filter(k => k.current_position)
      else if (toolInput.filter === 'high_volume') filtered = data.filter(k => k.monthly_volume >= 1000)
      const label = toolInput.filter && toolInput.filter !== 'all' ? ` (filter: ${toolInput.filter})` : ''
      return `Keyword bank for ${client.name}${label} — ${filtered.length} keywords. Treat rows with inferred coverage as already targeted unless the user asks for a stronger/dedicated page:\n\n` + filtered.map(k => {
        const targeting = targetingFor(k)
        const targetingText = targeting.value
          ? `${targeting.value}${targeting.inferred ? ` (${targeting.reason})` : ''}`
          : 'nothing yet'
        return `• "${k.keyword}" | ${k.intent || '—'} | ${k.funnel_stage || '—'} | vol: ${k.monthly_volume || '?'} | KD: ${k.difficulty || '?'} | pos: ${k.current_position || 'not ranking'} | opp_score: ${k.opportunity_score ?? '—'} | targeting: ${targetingText}${k.cluster ? ` | cluster: ${k.cluster}` : ''}`
      }).join('\n')
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

        // ── Fix 2: unified content record ────────────────────────────────────────
        const fileTitle = toolInput.file_path.split('/').pop()?.replace(/\.[^.]+$/, '') || toolInput.file_path
        let uid = userId
        if (!uid) { const { data: authData } = await supabase.auth.getUser(); uid = authData.user?.id ?? null }
        const { data: outputRow } = await supabase.from('content_outputs').insert({
          client_id: client.id,
          user_id: uid,
          agent_type: 'seo',
          title: fileTitle,
          content: cleanContent(toolInput.content.slice(0, 50000)), // cap at 50k chars for DB
          primary_keyword: fileTitle,
          approved: false,
          notes: `Written by Ada via write_file. Path: ${toolInput.file_path}`,
        }).select().single()
        if (outputRow) {
          await supabase.from('content_history').insert({
            client_id: client.id,
            user_id: uid,
            title: fileTitle,
            primary_keyword: fileTitle,
            summary: toolInput.commit_message || `File written: ${toolInput.file_path}`,
            published_at: new Date().toISOString(),
          })
        }
        // ─────────────────────────────────────────────────────────────────────────

        // ── Notify: output ready ──────────────────────────────────────────────
        if (outputRow && workspaceId) {
          fetch('/api/notifications/output-ready', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workspace_id: workspaceId,
              output_id: outputRow.id,
              title: fileTitle,
              client_name: client.name,
              primary_keyword: fileTitle,
            }),
          }).catch((err: any) => console.error('[write_file] output-ready notification failed:', err?.message))
        }
        // ─────────────────────────────────────────────────────────────────────

        return `File committed to production branch: ${toolInput.file_path}\nCommit: ${toolInput.commit_message}\nURL: ${data.url}`
      } catch { return 'Failed to write file.' }
    }

    // ── suggest_keyword: Ada proposes a keyword to keyword_suggestions ────────
    if (toolName === 'suggest_keyword') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Could not find client matching "${toolInput.client_name}".`
      const { data, error } = await supabase.from('keyword_suggestions').insert({
        client_id: client.id,
        keyword: toolInput.keyword,
        rationale: toolInput.rationale || null,
        monthly_volume_estimate: toolInput.monthly_volume_estimate || null,
        difficulty_estimate: toolInput.difficulty_estimate || null,
        intent: toolInput.intent || null,
        funnel_stage: toolInput.funnel_stage || null,
        cluster: toolInput.cluster || null,
        status: 'pending',
        suggested_by: id,
      }).select().single()
      if (error) return `Failed to save keyword suggestion: ${error.message}`
      await fetch('/api/agent-activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: id, client_id: client.id, action: 'keyword_suggestion', detail: `Suggested keyword: "${toolInput.keyword}"`, tokens_used: 0 }) })
      return `Keyword suggestion saved: "${toolInput.keyword}" — awaiting user approval in /keywords.`
    }

    // ── create_content_plan: Ada builds a content calendar ───────────────────
    if (toolName === 'create_content_plan') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Could not find client matching "${toolInput.client_name}".`
      const entries: any[] = toolInput.entries || []
      if (!entries.length) return 'No calendar entries provided in the plan.'
      try {
        const inserts = entries.map(e => ({
          client_id: client.id,
          workspace_id: workspaceId,
          title: e.title,
          primary_keyword: e.primary_keyword || null,
          content_type: e.content_type || 'blog_post',
          scheduled_date: e.scheduled_date || null,
          status: 'planned',
          notes: e.notes || null,
        }))
        const { data, error } = await supabase.from('content_calendar').insert(inserts).select()
        if (error) {
          console.error('create_content_plan error:', error)
          return JSON.stringify({ success: false, error: error.message, hint: (error as any).hint })
        }
        await fetch('/api/agent-activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: id, client_id: client.id, action: 'content_plan', detail: `Created content plan with ${entries.length} entries`, tokens_used: 0 }) })
        return `Content plan created: ${entries.length} entries added to the calendar.\n\nEntries:\n${entries.map(e => `• ${e.title}${e.scheduled_date ? ` (${e.scheduled_date})` : ''}`).join('\n')}`
      } catch (e: any) {
        console.error('create_content_plan exception:', e)
        return JSON.stringify({ success: false, error: e.message })
      }
    }

    // ── analyse_competitors: Ada summarises competitor insights + gap analysis ──
    if (toolName === 'analyse_competitors') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Could not find client matching "${toolInput.client_name}".`
      const { data: compSites } = await supabase.from('competitor_sites').select('id,url,name').eq('client_id', client.id)
      if (!compSites || compSites.length === 0) return `No competitors registered for ${client.name}. Add them in the Competitors tab on the client page.`
      const { data: compPages } = await supabase.from('competitor_pages').select('url,title,h1,meta_description,word_count,keywords,content,content_summary,competitor_id').eq('client_id', client.id).order('word_count', { ascending: false }).limit(50)

      const { data: clientPages } = await supabase
        .from('site_pages')
        .select('url,title,h1,content_summary')
        .eq('client_id', client.id)
        .limit(60)

      const clientTopics = (clientPages || []).map(p =>
        `${p.title || ''} ${p.h1 || ''} ${p.content_summary || ''}`.toLowerCase()
      ).join(' ')

      const perSite = compSites.map(site => {
        const pages = (compPages || []).filter(p => p.competitor_id === site.id)
        if (pages.length === 0) {
          const host = (() => {
            try { return new URL(site.url).hostname } catch { return site.url }
          })()
          return `${site.name || site.url} — no pages crawled yet. Re-crawl this competitor from the Competitors tab. If the crawl still finds no pages, use web_search with site:${host} plus the client's service/location themes to inspect public competitor content manually.`
        }
        const withSummaries = pages.filter(p => p.content_summary)
        const gaps = withSummaries.filter(p => {
          const pageTopics = `${p.title || ''} ${p.content_summary || ''}`.toLowerCase()
          const keyTerms = pageTopics.split(/\s+/).filter((w: string) => w.length > 5).slice(0, 6)
          const matchCount = keyTerms.filter((term: string) => clientTopics.includes(term)).length
          return matchCount < 2
        })

        const pageList = pages.slice(0, 15).map((p: any) =>
          `  ${p.url.replace(/^https?:\/\/[^/]+/, '') || '/'} | ${p.word_count || 0}w | ${p.title || p.h1 || 'untitled'} | ${p.meta_description || p.content_summary || 'no summary'}`
        ).join('\n')

        const gapList = gaps.slice(0, 8).map((p: any) =>
          `  GAP: ${p.title || p.url} — ${p.content_summary || 'no summary'}`
        ).join('\n')

        return `${site.name || site.url} — ${pages.length} pages crawled, ${withSummaries.length} summarised\n${pageList}${gapList ? `\n\nPotential content gaps vs this competitor:\n${gapList}` : ''}`
      })

      await fetch('/api/agent-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: id, client_id: client.id, action: 'competitor_analysis', detail: `Analysed ${compSites.length} competitors`, tokens_used: 0 })
      })

      // Store result in client_knowledge so it can be injected into future prompts without re-running
      try {
        const { data: existing } = await supabase
          .from('client_knowledge')
          .select('agent_notes')
          .eq('client_id', client.id)
          .maybeSingle()
        const notes = (existing?.agent_notes as Record<string, any>) || {}
        await supabase.from('client_knowledge').upsert({
          client_id: client.id,
          workspace_id: workspaceId,
          agent_notes: {
            ...notes,
            competitor_analysis: {
              updated_at: new Date().toISOString(),
              result: perSite.join('\n\n').slice(0, 4000),
            },
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id' })
      } catch { /* non-critical */ }

      const crawledPageCount = (compPages || []).length
      const emptyCrawlNote = crawledPageCount === 0
        ? '\n\nNo crawled competitor pages are stored yet, so do not present this as a complete competitor gap analysis. Use the registered competitor URLs as seed sites for web_search, or ask the user to re-crawl after checking the diagnostics in the Competitors tab.'
        : ''
      return `Competitor analysis for ${client.name} — ${compSites.length} competitors:\n\nNote: gaps are identified by comparing competitor page topics against your live site. Verify before acting.${emptyCrawlNote}\n\n${perSite.join('\n\n')}`
    }

    // ── startup_seo_brief: seed SEO strategy without relying on GSC ───────────
    if (toolName === 'startup_seo_brief') {
      const requested = toolClientName(toolInput).toLowerCase()
      const client = clients.find(c => c.name.toLowerCase() === requested)
        || clients.find(c => c.name.toLowerCase().includes(requested))
      if (!client) return `Could not find client matching "${toolClientName(toolInput)}".`

      const [
        { data: fetchedPages },
        { data: keywords },
        { data: history },
        { data: compSites },
        { data: compPages },
        { data: gscSample },
      ] = await Promise.all([
        supabase.from('site_pages').select('url,title,h1,meta_description,word_count,content_summary').eq('client_id', client.id).order('url').limit(60),
        supabase.from('keyword_banks').select('keyword,cluster,intent,funnel_stage,monthly_volume,difficulty,current_position,content_targeting_this,priority').eq('client_id', client.id).order('priority').order('keyword').limit(80),
        supabase.from('content_history').select('title,url,primary_keyword,summary,published_at').eq('client_id', client.id).order('published_at', { ascending: false }).limit(30),
        supabase.from('competitor_sites').select('id,url,name').eq('client_id', client.id),
        supabase.from('competitor_pages').select('competitor_id,url,title,h1,meta_description,word_count,content_summary').eq('client_id', client.id).order('word_count', { ascending: false }).limit(80),
        supabase.from('search_performance').select('query,position,impressions,clicks').eq('client_id', client.id).not('query', 'in', '("__total__","__page__","__device__")').order('impressions', { ascending: false }).limit(10),
      ])

      const pages = (sitePages[client.id]?.length ? sitePages[client.id] : fetchedPages) || []
      const gscStatus = gscSample && gscSample.length > 0
        ? `GSC has ${gscSample.length} sampled query row(s). Use analyse_gsc for performance-led opportunities if needed.`
        : 'No GSC query rows found. Treat this as startup/no-history SEO: do not wait for Search Console data before recommending seed keywords, service pages, location pages, and trust-building content.'

      const profileLines = [
        client.industry ? `Industry: ${client.industry}` : null,
        client.website ? `Website: ${client.website}` : null,
        client.description ? `About: ${client.description}` : null,
        client.icp ? `Ideal customer: ${client.icp}` : null,
        client.usp ? `USP: ${client.usp}` : null,
        client.service_differentiators ? `Service differentiators: ${client.service_differentiators}` : null,
        client.location_info ? `Locations served: ${client.location_info}` : null,
        client.target_keywords ? `Target keywords/seeds: ${client.target_keywords}` : null,
        client.trust_signals ? `Trust signals: ${client.trust_signals}` : null,
        client.content_goals ? `Content goals: ${client.content_goals}` : null,
      ].filter(Boolean).join('\n') || 'No profile context saved yet.'

      const pageLines = pages.length > 0
        ? pages.slice(0, 25).map((p: any) => `- ${p.title || p.h1 || p.url} | ${p.url} | ${p.word_count || 0}w | ${p.content_summary || 'no summary'}`).join('\n')
        : 'No crawled site pages yet. Recommend starting with core service, location, about/trust, and contact/conversion pages.'

      const targetedCount = (keywords || []).filter((k: any) => k.content_targeting_this).length
      const keywordLines = keywords && keywords.length > 0
        ? keywords.slice(0, 40).map((k: any) => `- ${k.keyword} | ${k.intent || 'unknown intent'} | ${k.funnel_stage || 'unknown stage'} | vol ${k.monthly_volume ?? 'est needed'} | KD ${k.difficulty ?? 'est needed'} | ${k.content_targeting_this ? `targeted by ${k.content_targeting_this}` : 'not targeted'}`).join('\n')
        : 'No keyword bank entries yet. Build seed ideas from services, locations, problems, comparisons, pricing, credentials, and competitor SERPs.'

      const historyLines = history && history.length > 0
        ? history.slice(0, 20).map((h: any) => `- ${h.title} | ${h.primary_keyword || 'no keyword'} | ${h.url || 'no URL'} | ${h.summary || 'no summary'}`).join('\n')
        : 'No content history yet.'

      const competitorLines = compSites && compSites.length > 0
        ? compSites.map((site: any) => {
            const pagesForSite = (compPages || []).filter((p: any) => p.competitor_id === site.id)
            const pageSample = pagesForSite.slice(0, 5).map((p: any) => `    - ${p.title || p.h1 || p.url} | ${p.url} | ${p.meta_description || p.content_summary || 'no summary'}`).join('\n')
            return `- ${site.name || site.url} | ${site.url} | ${pagesForSite.length} crawled page(s)${pageSample ? `\n${pageSample}` : '\n    - No pages stored. Use this URL as a web_search seed if crawl diagnostics show blocking.'}`
          }).join('\n')
        : 'No competitors registered yet. Ask for 3-5 direct competitors, or use web_search to find SERP competitors for core service/location terms.'

      return `Startup SEO brief for ${client.name}

GSC status:
${gscStatus}

Client profile:
${profileLines}

Existing live pages (${pages.length}):
${pageLines}

Keyword bank (${keywords?.length || 0} total, ${targetedCount} targeted):
${keywordLines}

Content history:
${historyLines}

Competitors:
${competitorLines}

How to use this brief:
- Build seed keywords from services, locations, audience problems, comparison/alternative terms, pricing/eligibility terms, and trust credentials.
- Prioritise bottom-funnel service and location pages first, then comparison/FAQ content, then top-funnel educational posts.
- Use web_search before giving current SERP angles or volume/difficulty estimates.
- When a valuable seed keyword is missing from the keyword bank, call suggest_keyword before recommending it as part of a plan.
- Be explicit when a recommendation is based on startup inference rather than historical GSC performance.`
    }

    // ── suggest_internal_links ─────────────────────────────────────────────────
    if (toolName === 'suggest_internal_links') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Could not find client matching "${toolInput.client_name}".`
      const pages = sitePages[client.id] || []
      if (pages.length === 0) return 'No crawled pages for this client — run a site crawl first.'
      const kwWords = (toolInput.new_page_keyword || '').toLowerCase().split(/\s+/).filter(Boolean)
      const titleWords = (toolInput.new_page_title || '').toLowerCase().split(/\s+/).filter(Boolean)
      const allWords = [...new Set([...kwWords, ...titleWords])]
      const scored = pages
        .filter(p => p.url !== toolInput.new_page_url)
        .map(p => {
          const haystack = [p.title, p.h1, p.content_summary].filter(Boolean).join(' ').toLowerCase()
          const score = allWords.reduce((s, w) => s + (haystack.includes(w) ? 1 : 0), 0)
          return { page: p, score }
        })
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
      if (scored.length === 0) return `No obviously relevant pages found to link to "${toolInput.new_page_title}".`
      const suggestions = scored.map(s => `${s.page.title || s.page.url} (${s.page.url}) — suggested anchor: '${kwWords.slice(0, 3).join(' ')}'`)
      const body = `Internal links to add for "${toolInput.new_page_title}":\n${suggestions.join('\n')}`
      await fetch('/api/briefing-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: client.id, type: 'suggestion', title: 'Internal links needed', body, action_url: `/clients/${client.id}?tab=pages`, priority: 30, dismissed: false }) })
      await fetch('/api/agent-activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: id, client_id: client.id, action: 'internal_links_suggested', detail: `Suggested ${suggestions.length} internal links for "${toolInput.new_page_title}"`, tokens_used: 0 }) })
      return `Suggested internal links:\n${suggestions.join('\n')}`
    }

    if (toolName === 'analyse_gsc') {
      const client = clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Could not find client matching "${toolInput.client_name}".`
      const period = toolInput.period || '28d'

      const { data: rows } = await supabase
        .from('search_performance')
        .select('*')
        .eq('client_id', client.id)
        .not('query', 'in', '("__total__","__page__","__device__")')
        .order('impressions', { ascending: false })
        .limit(200)

      const { data: totalsAll } = await supabase
        .from('search_performance')
        .select('*')
        .eq('client_id', client.id)
        .eq('query', '__total__')

      if (!rows || rows.length === 0) {
        return `No GSC query data for ${client.name}. This is normal for a new site, a newly connected property, or a client with very low search history. Do not wait for GSC before helping: call startup_seo_brief, then use the client profile, live pages, keyword bank, competitors, and web_search/SERP research to build a seed SEO plan.`
      }

      // Sort totals by period_start ascending → [90d, 28d, 7d]
      const sortedTotals = (totalsAll || []).sort((a: any, b: any) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime())
      let totalRow: any = null
      if (period === '90d') totalRow = sortedTotals[0]
      else if (period === '28d') totalRow = sortedTotals[1] ?? sortedTotals[0]
      else totalRow = sortedTotals[sortedTotals.length - 1]

      const totalClicks = totalRow?.clicks ?? rows.reduce((a: number, r: any) => a + r.clicks, 0)
      const totalImpressions = totalRow?.impressions ?? rows.reduce((a: number, r: any) => a + r.impressions, 0)
      const avgPos = totalRow?.position ?? (rows.length > 0 ? rows.reduce((a: number, r: any) => a + r.position * (r.impressions || 1), 0) / Math.max(rows.reduce((a: number, r: any) => a + (r.impressions || 1), 0), 1) : 0)
      const avgCtr = totalRow?.ctr ?? (rows.length > 0 ? rows.reduce((a: number, r: any) => a + r.ctr, 0) / rows.length : 0)

      const nearMisses = rows
        .filter((r: any) => r.position >= 5 && r.position <= 15 && r.impressions > 50)
        .sort((a: any, b: any) => b.impressions - a.impressions)
        .slice(0, 10)
        .map((r: any) => ({
          query: r.query,
          position: Math.round(r.position * 10) / 10,
          impressions: r.impressions,
          clicks: r.clicks,
          ctr: (r.ctr * 100).toFixed(1) + '%',
          opportunity: `Moving from position ${Math.round(r.position)} to page 1 could drive ~${Math.round(r.impressions * 0.28)} additional clicks/month`,
        }))

      const lowCtr = rows
        .filter((r: any) => r.position <= 10 && r.ctr < 0.03 && r.impressions > 100)
        .map((r: any) => ({
          query: r.query,
          position: Math.round(r.position * 10) / 10,
          impressions: r.impressions,
          ctr: (r.ctr * 100).toFixed(1) + '%',
          issue: 'Ranking well but low CTR — title tag or meta description likely needs improvement',
        }))

      // Discover new keywords from GSC data
      let newSuggestions = 0
      if (workspaceId) {
        try {
          const { discoverKeywordsFromGSC } = await import('@/lib/gsc-keywords')
          newSuggestions = await discoverKeywordsFromGSC(
            supabase as any,
            client.id,
            workspaceId,
            rows.map((r: any) => ({ query: r.query, impressions: r.impressions, clicks: r.clicks, position: r.position }))
          )
        } catch { /* non-critical */ }
      }

      return JSON.stringify({
        period,
        summary: {
          total_clicks: totalClicks,
          total_impressions: totalImpressions,
          average_position: Math.round(avgPos * 10) / 10,
          ctr: (avgCtr * 100).toFixed(2) + '%',
        },
        near_misses: nearMisses,
        low_ctr_opportunities: lowCtr.slice(0, 5),
        top_queries: rows.slice(0, 10).map((r: any) => ({ query: r.query, position: Math.round(r.position * 10) / 10, clicks: r.clicks, impressions: r.impressions })),
        insight_count: nearMisses.length + lowCtr.length,
        keyword_discovery: { new_suggestions: newSuggestions },
      }, null, 2)
    }

    if (toolName === 'update_agent_notes') {
      const client = clients.find(c => c.name.toLowerCase() === (toolInput.client_name || '').toLowerCase())
        || clients.find(c => c.name.toLowerCase().includes((toolInput.client_name || '').toLowerCase()))
      if (!client) return `Client "${toolInput.client_name}" not found.`

      const { data: existing } = await supabase
        .from('client_knowledge')
        .select('agent_notes')
        .eq('client_id', client.id)
        .maybeSingle()

      const currentNotes = ((existing?.agent_notes as Record<string, any>) || {})
      const noteSlug = agent?.slug || agent?.name?.toLowerCase() || 'ada'
      currentNotes[noteSlug] = toolInput.notes

      const { error } = await supabase
        .from('client_knowledge')
        .upsert({
          client_id: client.id,
          workspace_id: workspaceId,
          agent_notes: currentNotes,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id' })

      if (error) return `Failed to save notes: ${error.message}`
      return `Notes saved for ${client.name}.`
    }

    return 'Unknown tool.'
  }

  async function summariseOldMessages(msgs: any[]): Promise<any[]> {
    if (msgs.length <= 8) return msgs
    const toSummarise = msgs.slice(0, -6)
    const toKeep = msgs.slice(-6)
    const historyText = toSummarise.map(m => {
      const role = m.role === 'user' ? 'User' : 'Ada'
      const content = typeof m.content === 'string'
        ? m.content.slice(0, 500)
        : '[tool calls/results]'
      return `${role}: ${content}`
    }).join('\n')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: id,
          client_id: clients.length === 1 ? clients[0].id : null,
          session_tokens: sessionTokensRef.current,
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: `Summarise this conversation history in 3-5 bullet points. Capture: what was discussed, what data was found, what was recommended, what was created or saved. Be specific -- include keyword names, URLs, and numbers where they appeared.\n\n${historyText}`,
          }],
        }),
      })
      const data = await res.json()
      const summary = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()
      if (!summary) return msgs
      return [
        { role: 'user', content: '[Earlier in this conversation]' },
        { role: 'assistant', content: `Summary of earlier context:\n${summary}` },
        ...toKeep,
      ]
    } catch {
      return msgs
    }
  }

  async function send() {
    if (!draft.trim() || !agent || sending) return
    // Resolve userId inline so RLS inserts never fail due to async state lag
    let uid = userId
    if (!uid) {
      const { data: authData } = await supabase.auth.getUser()
      uid = authData.user?.id ?? null
      if (uid) setUserId(uid)
    }
    let convId = activeConv
    if (!convId) {
      const { data, error } = await supabase.from('conversations').insert({ agent_id: id, title: draft.slice(0, 60), user_id: uid }).select().single()
      if (!data) { console.error('Failed to create conversation:', error?.message); return }
      convId = data.id; setActiveConv(convId); setConversations(prev => [data, ...prev])
    }
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: draft, created_at: new Date().toISOString() }
    const placeholder: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', created_at: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg, placeholder])
    setDraft(''); setSending(true)
    draftSavedRef.current = false
    setAgentStatus('Thinking…')
    setTaskLog([]); taskLogRef.current = []
    setThoughts([]); thoughtsRef.current = []
    pendingDraftCardRef.current = null
    await supabase.from('messages').insert({ conversation_id: convId, role: 'user', content: userMsg.content, user_id: uid })
    const systemPrompt = buildSystemPrompt(agent, clients, knowledgePanels, latestDigest)
    const addTask = (label: string, done = false) => {
      const entry: TaskEntry = { label, done, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
      taskLogRef.current = [...taskLogRef.current, entry]
      setTaskLog([...taskLogRef.current])
    }
    const completeLastTask = () => {
      taskLogRef.current = taskLogRef.current.map((t, i) => i === taskLogRef.current.length - 1 ? { ...t, done: true } : t)
      setTaskLog([...taskLogRef.current])
    }
    // Build agentic message loop — keeps going until Ada stops using tools
    // Strip any __META__ prefixes that snuck into state (defensive decode)
    const rawMessages = [...messages.filter(m => m.content), userMsg].map(m => ({
      role: m.role,
      content: m.role === 'assistant' ? stripToolCallJson(decodeMessageMeta(m.content).content) : m.content,
    }))
    // Summarise old turns to reduce input tokens on long conversations
    const apiMessages: any[] = rawMessages.length > 8
      ? await summariseOldMessages(rawMessages)
      : rawMessages
    // Helper to save + display the assistant message
    const saveReply = async (reply: string) => {
      const cleanReply = stripToolCallJson(reply) || 'Done.'
      const stored = encodeMessageMeta(cleanReply, taskLogRef.current, thoughtsRef.current.map(stripToolCallJson).filter(Boolean))
      await supabase.from('messages').insert({ conversation_id: convId, role: 'assistant', content: stored, user_id: uid })
      await supabase.from('conversations').update({ updated_at: new Date().toISOString(), title: userMsg.content.slice(0, 60) }).eq('id', convId)
      setMessages(prev => prev.map(m => m.id === placeholder.id ? { ...m, content: cleanReply, _taskLog: [...taskLogRef.current], _thoughts: thoughtsRef.current.map(stripToolCallJson).filter(Boolean), _draftCard: pendingDraftCardRef.current || undefined } : m))
    }
    // Quick acknowledgement — Haiku, no tools, shows user the agent has started
    try {
      const ackRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: id,
          client_id: clients.length === 1 ? clients[0].id : null,
          session_tokens: sessionTokensRef.current,
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          system: systemPrompt,
          tools: [],
          messages: [...apiMessages, {
            role: 'user',
            content: `[INTERNAL] In one sentence, acknowledge you are starting this task and say what data you are pulling first. Plain prose only, no markdown, no filler phrases like "Certainly" or "Of course".`,
          }],
        }),
      })
      const ackData = await ackRes.json()
      const ackText = stripToolCallJson((ackData.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim())
      if (ackText) {
        setMessages(prev => prev.map(m => m.id === placeholder.id ? { ...m, content: ackText } : m))
      }
    } catch { /* non-critical */ }

    const userText = typeof userMsg.content === 'string' ? userMsg.content.toLowerCase() : ''
    const isWritingTurn = ['write', 'draft', 'blog post', 'article', 'content plan', 'create a plan'].some(kw => userText.includes(kw))

    try {
      let loopCount = 0
      let savedReply = false
      let prevStopReason: string | null = null
      let totalTokensUsed = 0
      tokenAccumRef.current = 0
      while (loopCount < 12) {
        loopCount++
        setAgentStatus(loopCount === 1 ? 'Thinking…' : 'Working…')

        const isFetchOnlyTurn: boolean = (
          ['what keywords', 'show me', 'list', 'how is', 'what does', 'summarise', 'summarize', 'pull', 'fetch', 'check'].some(kw => userText.includes(kw)) ||
          (loopCount > 1 && prevStopReason === 'tool_use')
        )
        const model: string = isFetchOnlyTurn && !isWritingTurn ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6'
        const maxTokens: number = isWritingTurn ? 16000 : isFetchOnlyTurn ? 2000 : 4000

        const res: Response = await fetch('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: id,
            client_id: clients.length === 1 ? clients[0].id : null,
            session_tokens: sessionTokensRef.current,
            model,
            max_tokens: maxTokens,
            system: systemPrompt,
            tools: getToolsForAgent(agent.agent_type),
            messages: apiMessages,
          }),
        })
        const data: any = await res.json()
        const turnTokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
        totalTokensUsed += turnTokens
        tokenAccumRef.current = totalTokensUsed
        if (data.usage) {
          const turnCost = model.includes('haiku')
            ? estimateHaikuCost(data.usage.input_tokens || 0, data.usage.output_tokens || 0)
            : estimateSonnetCost(data.usage.input_tokens || 0, data.usage.output_tokens || 0)
          sessionTokensRef.current += turnTokens
          setSessionTokens(sessionTokensRef.current)
          setSessionCost(prev => prev + turnCost)
        }
        prevStopReason = data.stop_reason ?? null
        if (data.error || !data.content) {
          const errMsg = typeof data.error === 'string' ? data.error : (data.error?.message || 'Something went wrong — try again.')
          const errReply = `⚠️ ${errMsg}`
          await saveReply(errReply)
          savedReply = true
          break
        }

        // Capture any reasoning text Ada emits before a tool call
        const thinkingText = stripToolCallJson((data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim())
        if (thinkingText) {
          thoughtsRef.current = [...thoughtsRef.current, thinkingText]
          setThoughts([...thoughtsRef.current])
        }

        if (data.stop_reason === 'tool_use') {
          // Strip large content fields from write_file/write_content tool inputs before pushing
          // to history — prevents large file contents from bloating context on every turn
          const trimmedContent = data.content.map((b: any) => {
            if (b.type === 'tool_use' && (b.name === 'write_file' || b.name === 'write_content') && b.input?.content?.length > 2000) {
              return { ...b, input: { ...b.input, content: `[file content trimmed — ${b.input.content.length} chars]` } }
            }
            return b
          })
          apiMessages.push({ role: 'assistant', content: trimmedContent })
          const toolResults: any[] = []
          const toolBlocks = data.content.filter((b: any) => b.type === 'tool_use' && b.name !== 'web_search')
          // Add all tasks to the log upfront and capture their indices so parallel completions
          // can mark the correct entry done (completeLastTask only marks index length-1).
          const taskIndices: number[] = []
          toolBlocks.forEach((block: any) => {
            const label = TOOL_STATUS[block.name] || `Using ${block.name.replace(/_/g, ' ')}…`
            taskIndices.push(taskLogRef.current.length)
            addTask(label)
          })
          if (toolBlocks.length > 1) {
            setAgentStatus(`Running ${toolBlocks.length} tools in parallel…`)
          } else if (toolBlocks.length === 1) {
            setAgentStatus(TOOL_STATUS[toolBlocks[0].name] || `Using ${toolBlocks[0].name.replace(/_/g, ' ')}…`)
          }
          // Execute all tool calls in parallel — Anthropic supports multiple tool_use blocks
          // per assistant message; results are returned as a single tool_result array.
          const parallelResults = await Promise.all(toolBlocks.map(async (block: any, i: number) => {
            const result = await handleToolCall(block.name, block.input, convId!)
            // Mark this specific task done by index rather than always marking the last entry
            taskLogRef.current = taskLogRef.current.map((t, idx) =>
              idx === taskIndices[i] ? { ...t, done: true } : t
            )
            setTaskLog([...taskLogRef.current])
            // Trim large tool results before storing in history (read_file, audit_site can return 80KB+)
            const MAX_RESULT = 8000
            const trimmedResult = result.length > MAX_RESULT
              ? result.slice(0, MAX_RESULT) + `\n\n[... result truncated at ${MAX_RESULT} chars to fit context window]`
              : result
            return { type: 'tool_result', tool_use_id: block.id, content: trimmedResult }
          }))
          toolResults.push(...parallelResults)
          apiMessages.push({ role: 'user', content: toolResults })
          // After write_content succeeded, allow one more turn for Ada's summary then stop
          if (draftSavedRef.current && loopCount >= 6) {
            const wrapRes = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agent_id: id,
                client_id: clients.length === 1 ? clients[0].id : null,
                session_tokens: sessionTokensRef.current,
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 500,
                system: systemPrompt,
                messages: apiMessages,
              }),
            })
            const wrapData = await wrapRes.json()
            const wrapReply = (wrapData.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
            await saveReply(wrapReply || 'Draft saved and ready for review.')
            savedReply = true
            break
          }
        } else if (data.stop_reason === 'max_tokens') {
          const partial = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
          const reply = (partial || 'Response cut off — the file was too large to write in one go.') + '\n\n_Output was cut short. Reply "continue" to get the rest._'
          await saveReply(reply)
          savedReply = true
          break
        } else {
          // end_turn — build reply; if empty, ask Ada to summarise so we never save a blank message
          setAgentStatus('Done')
          let reply = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
          if (!reply && taskLogRef.current.length > 0) {
            // Ada finished silently after tool calls — ask for a one-line summary then save that
            apiMessages.push({ role: 'assistant', content: data.content && data.content.length > 0 ? data.content : [{ type: 'text', text: '' }] })
            apiMessages.push({ role: 'user', content: [{ type: 'text', text: 'Briefly summarise what you just did in 1-3 sentences.' }] })
            const summaryRes = await fetch('/api/chat', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agent_id: id,
                client_id: clients.length === 1 ? clients[0].id : null,
                session_tokens: sessionTokensRef.current,
                model: 'claude-sonnet-4-6',
                max_tokens: 512,
                system: systemPrompt,
                messages: apiMessages,
              }),
            })
            const summaryData = await summaryRes.json()
            reply = (summaryData.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim() || 'Done — all changes committed.'
          } else if (!reply) {
            reply = 'Done.'
          }
          await saveReply(reply)
          savedReply = true
          break
        }
      }
      // Loop hit max iterations without saving — save what we have
      if (!savedReply) {
        await saveReply('Working... loop limit reached. Reply to continue.')
      }
      // Auto debrief — only for SEO agents after significant tool use (draft saved or GSC analysed)
      const hadSignificantAction = taskLogRef.current.some(t =>
        ['Saving draft', 'Loading keyword bank', 'Analysing GSC', 'Checking content history'].some(label =>
          t.label?.includes(label)
        )
      )
      if (agent.agent_type === 'seo' && taskLogRef.current.length > 0 && hadSignificantAction) {
        // Fire-and-forget — non-critical, never blocks the UI
        void (async () => {
          try {
            const activeClient = clients.length === 1 ? clients[0] : null
            if (!activeClient) return
            const { data: existing } = await supabase.from('client_knowledge').select('agent_notes').eq('client_id', activeClient.id).maybeSingle()
            const currentNotes = ((existing?.agent_notes as Record<string, any>) || {})
            const slug = agent.slug || agent.name?.toLowerCase() || 'ada'
            const existingHistory: any[] = currentNotes[slug]?.history || []
            const debriefRes = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agent_id: id,
                client_id: activeClient.id,
                session_tokens: sessionTokensRef.current,
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 400,
                messages: [{
                  role: 'user',
                  content: `You are ${agent.name}. Summarise this conversation in JSON with keys: summary (1 sentence), recommendations (string[]), pending (string[]). Tasks done: ${taskLogRef.current.map(t => t.label?.replace('…', '')).filter(Boolean).join(', ')}. Reply with JSON only.`,
                }],
              }),
            })
            const debriefData = await debriefRes.json()
            const raw = (debriefData.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()
            let parsed: any = {}
            try { parsed = JSON.parse(raw.replace(/^```json\n?/, '').replace(/\n?```$/, '')) } catch { return }
            const newEntry = { date: new Date().toISOString(), ...parsed }
            const updatedHistory = [...existingHistory.slice(-9), newEntry]
            await supabase.from('client_knowledge').upsert({
              client_id: activeClient.id,
              workspace_id: workspaceId,
              agent_notes: { ...currentNotes, [slug]: { last_conversation: parsed, history: updatedHistory } },
              updated_at: new Date().toISOString(),
            }, { onConflict: 'client_id' })
          } catch { /* non-critical */ }
        })()
      }

    } catch (e: any) {
      const errReply = `⚠️ ${e.message || 'Something went wrong'}`
      try { await saveReply(errReply) } catch { setMessages(prev => prev.map(m => m.id === placeholder.id ? { ...m, content: errReply } : m)) }
    }
    setSending(false)
    setAgentStatus(null)
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

  if (!agent) return <div style={{ color: 'var(--text-2)', fontSize: 14, padding: 40 }}>Loading...</div>

  return (
    <div style={{ height: 'calc(100dvh - 72px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24, flexShrink: 0 }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--brand)', border: '1px solid rgba(200,240,208,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600, color: 'var(--brand-accent)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {agent.avatar_initials || agent.name.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>{agent.name}</div>
          <div style={{ fontSize: 10, color: 'var(--brand-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{agent.role}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {Object.keys(sitePages).length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
              {Object.values(sitePages).reduce((a, b) => a + b.length, 0)} pages loaded
            </span>
          )}
          {sessionTokens > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: sending ? 'var(--accent)' : 'var(--text-dim)' }}>
                {(sessionTokens / 1000).toFixed(1)}k tokens
              </span>
              <span style={{ color: sessionCost > 0.10 ? 'var(--amber)' : 'var(--text-dim)' }}>
                ${sessionCost.toFixed(4)} (est.)
              </span>
            </div>
          )}
          {(['chat', 'settings'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ ...S.btnSm, background: tab === t ? 'var(--brand)' : 'var(--surface-2)', color: tab === t ? '#fff' : 'var(--text-2)', border: tab === t ? 'none' : '1px solid var(--border)', textTransform: 'capitalize', borderRadius: 'var(--radius-md)', letterSpacing: '0.3px' }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === 'chat' && (
        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
          <div style={{ width: 224, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button style={{ background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', padding: '9px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', width: '100%', marginBottom: 4 }} onClick={newConversation}>+ New chat</button>

            {/* Live activity queue */}
            {(sending || taskLog.length > 0) && (
              <div style={{ marginBottom: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                <div style={{ padding: '6px 10px', background: 'var(--brand)', borderBottom: '1px solid rgba(200,240,208,0.1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {sending && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-accent)', display: 'inline-block', animation: 'pulse-dot 1.6s ease-in-out infinite' }} />}
                  <span style={{ fontSize: 10, color: 'var(--brand-accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {sending ? 'Active' : 'Last session'}
                  </span>
                </div>
                <div style={{ padding: '6px 0' }}>
                  {sending && taskLog.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--radius)', margin: '2px 8px 4px', borderLeft: '2px solid var(--accent)' }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, animation: 'pulse 1s ease-in-out infinite' }} />
                      <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {taskLog[taskLog.length - 1]?.label || agentStatus || 'Working...'}
                      </span>
                    </div>
                  )}
                  {sending && !taskLog.length && agentStatus && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px' }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, animation: 'pulse 1s ease-in-out infinite' }} />
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{agentStatus}</span>
                    </div>
                  )}
                  {taskLog.map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px' }}>
                      <span style={{ fontSize: 11, flexShrink: 0, color: t.done ? 'var(--green)' : 'var(--accent)' }}>{t.done ? '✓' : '◌'}</span>
                      <span style={{ fontSize: 12, color: t.done ? 'var(--text-2)' : 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label.replace('…', '')}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{t.ts}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {plannedTasks.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6, padding: '0 2px' }}>Planned tasks</div>
                {plannedTasks.slice(0, 5).map(t => (
                  <div key={t.id} style={{ padding: '8px 10px', borderRadius: 'var(--radius)', background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 4 }}>
                    <div style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.primary_keyword}</div>
                    <div style={{ fontSize: 10, color: t.status === 'ready' ? 'var(--green)' : 'var(--amber)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>{t.status}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4, padding: '0 2px' }}>Conversations</div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              {conversations.map(c => (
                <div key={c.id} style={{ position: 'relative', marginBottom: 3 }}
                  onMouseEnter={e => { const btn = e.currentTarget.querySelector('.del-btn') as HTMLElement; if (btn) btn.style.opacity = '1' }}
                  onMouseLeave={e => { const btn = e.currentTarget.querySelector('.del-btn') as HTMLElement; if (btn) btn.style.opacity = '0' }}>
                  <button onClick={() => loadMessages(c.id)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', paddingRight: 28, borderRadius: 'var(--radius)', background: activeConv === c.id ? 'var(--surface-2)' : 'transparent', border: activeConv === c.id ? '1px solid var(--border)' : '1px solid transparent', cursor: 'pointer' }}>
                    <div style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || 'Conversation'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{fmt(c.created_at)}</div>
                  </button>
                  <button className="del-btn" onClick={(e) => deleteConversation(c.id, e)}
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 14, padding: '2px 4px', borderRadius: 4, opacity: 0, transition: 'opacity 0.15s' }}
                    title="Delete conversation">✕</button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {!activeConv ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>Start a conversation with {agent.name}</div>
                <div style={{ fontSize: 14, color: 'var(--text-2)', textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>
                  {agent.name} knows your clients, their keyword banks, and every live page on their websites.
                  {Object.keys(sitePages).length === 0 && <span style={{ color: 'var(--amber)' }}> Crawl a client site first to give her full page knowledge.</span>}
                </div>
                <button style={{ ...S.btn, marginTop: 8 }} onClick={newConversation}>Start chatting</button>
              </div>
            ) : (
              <>
                <div ref={scroller} style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 8 }}>
                  {messages.length === 0 && <div style={{ margin: 'auto' }}><div style={{ fontSize: 15, color: 'var(--text-2)' }}>Say something to get started.</div></div>}
                  {messages.filter((m, i) => m.role === 'user' || m.content || i === messages.length - 1).map((m, i, arr) => {
                    const msgTaskLog = m._taskLog || (m.id === messages[messages.length - 1]?.id && sending ? taskLog : [])
                    const isLastMessage = i === arr.length - 1
                    const displayContent = m.role === 'assistant' ? stripToolCallJson(m.content) : m.content
                    const { clean, suggestions } = m.role === 'assistant' ? parseSuggestions(displayContent) : { clean: displayContent, suggestions: [] }
                    return (
                    <div key={m.id || i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '82%', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      {/* Task log + thoughts — shown on assistant messages that used tools */}
                      {m.role === 'assistant' && (msgTaskLog.length > 0 || (sending && m.id === messages[messages.length - 1]?.id)) && (
                        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px', marginBottom: 6, fontSize: 12, minWidth: 240, maxWidth: 400 }}>
                          {msgTaskLog.map((t, ti) => (
                            <div key={ti} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', color: t.done ? 'var(--text-dim)' : 'var(--text-2)' }}>
                              <span style={{ color: t.done ? 'var(--green)' : 'var(--accent)', fontSize: 11 }}>{t.done ? '✓' : '◌'}</span>
                              <span style={{ flex: 1 }}>{t.label.replace('…','')}</span>
                              <span style={{ color: '#374151', fontFamily: 'monospace', fontSize: 10 }}>{t.ts}</span>
                            </div>
                          ))}
                          {sending && m.id === messages[messages.length - 1]?.id && agentStatus && agentStatus !== 'Done' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', color: 'var(--text-2)' }}>
                              <span style={{ display: 'inline-flex', gap: 2 }}>
                                {[0,1,2].map(d => <span key={d} style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: 'dot-bounce 1.2s ease-in-out infinite', animationDelay: `${d * 0.2}s` }} />)}
                              </span>
                              <span>{agentStatus}</span>
                            </div>
                          )}
                        </div>
                      )}
                      <div style={{ padding: '12px 16px', borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '3px 12px 12px 12px', background: m.role === 'user' ? 'var(--brand)' : 'var(--surface)', color: m.role === 'user' ? '#fff' : 'var(--text)', border: m.role === 'assistant' ? '1px solid var(--border)' : 'none', borderLeft: m.role === 'assistant' ? '2px solid var(--brand)' : 'none' }}>
                        {m.role === 'assistant' && clean
                          ? <div className="ada-message-content" dangerouslySetInnerHTML={{ __html: marked.parse(clean) as string }} />
                          : clean
                            ? <span style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{clean}</span>
                            : <span style={{ opacity: 0.5, fontSize: 14 }}>…</span>
                        }
                      </div>
                      {/* Suggested replies — only on last assistant message, only when not sending */}
                      {m.role === 'assistant' && suggestions.length > 0 && isLastMessage && !sending && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, maxWidth: '100%' }}>
                          {suggestions.map((s, si) => (
                            <button key={si} onClick={() => { setDraft(s); setTimeout(() => send(), 50) }}
                              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', fontSize: 12.5, color: 'var(--text-2)', cursor: 'pointer', transition: 'border-color 0.12s, color 0.12s', whiteSpace: 'nowrap' }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand)'; e.currentTarget.style.color = 'var(--text)' }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                      {m.role === 'assistant' && m._draftCard && (
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid var(--green)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginTop: 6, alignSelf: 'stretch' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>✓ Draft saved · &quot;{m._draftCard.title}&quot;</div>
                          <div style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>{m._draftCard.word_count} words · {m._draftCard.image_count} image{m._draftCard.image_count === 1 ? '' : 's'}</div>
                          <a href={m._draftCard.review_url} style={{ display: 'inline-block', fontSize: 13, color: 'var(--accent)', marginTop: 6, textDecoration: 'none', fontWeight: 500 }}>Review draft →</a>
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{m.role === 'assistant' ? agent.name : 'You'} · {clock(m.created_at)}</div>
                    </div>
                  )})}
                </div>
                <div style={{ flexShrink: 0 }}>
                  {/* Quick action chips — show when conversation is new/empty */}
                  {messages.length === 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>Quick actions</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                        {[
                          { label: '🔍 Audit site', msg: `Audit the site for ${clients[0]?.name || 'the client'}. Call audit_site, identify the most impactful SEO issues, prioritise them, and tell me what to fix first.` },
                          { label: '✍️ Write blog post', msg: `Write a complete, publish-ready blog post for ${clients[0]?.name || 'the client'}. Check search_history first to avoid repeating angles, then ask me for the target keyword before starting.` },
                          { label: '🔁 Rewrite article', msg: `I need to rewrite an existing article. Call search_history for ${clients[0]?.name || 'the client'}, then ask me which piece to rework. Once I confirm, rewrite it as clean markdown with fresh SEO-named images and save it with write_content for review.` },
                          { label: '📋 Content plan', msg: `Review the keyword bank and content history for ${clients[0]?.name || 'the client'}, then propose a 4-week content plan. For each piece include: target keyword, angle, content type, and why it's the right next move.` },
                          { label: '🔗 Fix broken links', msg: `Audit the site for ${clients[0]?.name || 'the client'} and find any pages with placeholder or broken internal links. Read those files and fix the links to point to real pages from the site inventory.` },
                          { label: '📈 Keyword gaps', msg: `Look at the keyword bank and content history for ${clients[0]?.name || 'the client'}. Identify the most valuable keyword gaps — high intent queries we haven't targeted yet — and recommend the top 5 to write next with a brief angle for each.` },
                        ].map(({ label, msg }) => (
                          <button key={label} onClick={() => { setDraft(msg) }} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 99, padding: '5px 12px', fontSize: 12, color: 'var(--text-2)', cursor: 'pointer', transition: 'all 0.12s', whiteSpace: 'nowrap' as const }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand)'; e.currentTarget.style.color = 'var(--text)' }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '10px 10px 10px 14px', display: 'flex', alignItems: 'flex-end', gap: 8, position: 'relative', overflow: 'hidden' }}>
                    {sending && (
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'var(--surface-3)', borderRadius: 1, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: 'var(--accent)', animation: 'progress-indeterminate 1.5s ease-in-out infinite', width: '40%' }} />
                      </div>
                    )}
                    <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder={`Message ${agent.name}...`} rows={2} style={{ flex: 1, resize: 'none', fontFamily: 'inherit', background: 'transparent', border: 'none', outline: 'none', boxShadow: 'none', padding: 0 }} />
                    <button onClick={send} disabled={!draft.trim() || sending} style={{ ...S.btn, flexShrink: 0, background: 'var(--brand)', borderRadius: 'var(--radius-md)', padding: '8px 14px', opacity: (!draft.trim() || sending) ? 0.4 : 1 }}>{sending ? '...' : 'Send'}</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div style={{ overflow: 'auto', flex: 1 }}>
          <div style={{ maxWidth: 680 }}>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 32, lineHeight: 1.6 }}>Every field here shapes how {agent.name} thinks, speaks and behaves. Changes take effect on the next message.</p>
            {SETTINGS_FIELDS.map(({ section, fields }) => (
              <div key={section} style={S.section}>
                <div style={S.sectionHead}>{section}</div>
                {fields.map(({ key, label, hint, type, ...rest }) => { const rows = (rest as any).rows as number | undefined; return (
                  <div key={key} style={S.field}>
                    <label style={S.label}>{label}</label>
                    {hint && <div style={S.hint}>{hint}</div>}
                    {type === 'textarea' ? <textarea rows={rows || 3} value={(settings as any)[key] || ''} onChange={e => setSetting(key as keyof Agent, e.target.value)} style={{ lineHeight: 1.6 }} /> : <input type="text" value={(settings as any)[key] || ''} onChange={e => setSetting(key as keyof Agent, e.target.value)} />}
                  </div>
                )})}
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 40 }}>
              <button style={S.btn} onClick={saveSettings} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
              {saved && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>Saved</span>}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
