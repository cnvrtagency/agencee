# Agencee — AI Collaboration Handover

**Updated after every session. Read this first before touching any code.**
Last updated: 2026-06-11 | Session: UX Fixes Pass

---

## What This Is

Agencee is a single-tenant SaaS for an agency owner (Dan) to run AI-powered SEO content operations for clients. Two AI agents — Ada (SEO/content) and Theo (technical publishing) — live inside a Next.js 14 app backed by Supabase. Dan briefs Ada in a chat UI, Ada plans + writes content using tool calls, Dan reviews + approves drafts, then publishes them to the client's GitHub repo in one atomic commit.

**Production URL:** Runs on Vercel. Dev: `http://localhost:3000`  
**Supabase project:** `https://qzyksnszutnorppfqchz.supabase.co`  
**GitHub client repo (Hear Better):** `https://github.com/cnvrtagency/wireframe-whisperer-89`

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 14 App Router | TypeScript throughout |
| Styling | CSS custom properties only | No Tailwind — all inline CSS objects with `var(--token)` |
| Database | Supabase (PostgreSQL) | RLS on all tables |
| AI models | Anthropic API | `claude-sonnet-4-6` in chat, `claude-opus-4-8` in scheduler |
| Image gen | Gemini `gemini-3-pro-image` | **NEVER change this model string** |
| Image storage | Supabase Storage `blog-images` | Public bucket |
| Pub platform | GitHub via Git Trees API | Atomic multi-file commit |
| Hosting | Vercel | Cron at 07:00 UTC daily |
| Email | Resend | from `notifications@agencee.app` |

---

## Environment Variables (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=https://qzyksnszutnorppfqchz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=          # client-side anon key
SUPABASE_SERVICE_KEY=                   # MUST be SERVICE_KEY — not SERVICE_ROLE_KEY
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
NEXT_PUBLIC_SITE_URL=
CRON_SECRET=                            # Required — cron route rejects all calls without it
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=.../api/auth/google/callback
ENCRYPTION_KEY=                         # 32 bytes base64 — AES-256-GCM for OAuth tokens
RESEND_API_KEY=
VERCEL_TOKEN=
VERCEL_PROJECT_ID=
VERCEL_TEAM_ID=                         # optional
```

**Critical gotchas:**
- `SUPABASE_SERVICE_KEY` not `SUPABASE_SERVICE_ROLE_KEY` — wrong name silently crashes API routes
- Never write `ENCRYPTION_KEY` or `SUPABASE_SERVICE_KEY` to temp files — read from `.env.local` at runtime only
- Gemini model is `gemini-3-pro-image` — do not change, do not version-suffix it

---

## Directory Map

```
src/
  app/
    globals.css                      CSS vars, base resets, ada-message-content prose styles
    layout.tsx                       Root layout (fonts, html)
    (app)/
      layout.tsx                     App shell: Sidebar + main content area
      page.tsx                       Dashboard — briefing room, stats, heatmap
      agents/
        page.tsx                     Agent cards with quick-nav pills
        [id]/page.tsx                ★ Chat + Settings tabs; full agentic tool loop (1652 lines)
        [id]/queue/page.tsx
        [id]/keywords/page.tsx       Keyword suggestions review (agent-scoped)
        [id]/calendar/page.tsx       Content calendar (agent-scoped)
        [id]/activity/page.tsx
      clients/
        page.tsx
        [id]/page.tsx                9-tab client detail (Profile/Keywords/Pages/Codebase/
                                     Connections/Competitors/Schedule/SearchPerformance/Reports)
        [id]/gsc-setup/page.tsx      GSC multi-property picker (post-OAuth)
      outputs/
        page.tsx                     ★ Workspace-level outputs list (all agents)
        [id]/page.tsx                ★ Output detail: pipeline, edit, approve, publish
      reports/, queue/, keywords/
      calendar/, activity/, marketplace/, settings/
    (auth)/
      login/, signup/, onboarding/page.tsx   5-step onboarding wizard
    api/
      chat/route.ts                  POST — proxies Anthropic API; logs agent_activity tokens
      crawl/route.ts                 POST — site crawl → site_pages
      github/route.ts                GET (read file) / PUT (write file via atomicCommit)
      connections/
        publish/route.ts             ★ POST — download images, rewrite URLs, atomicCommit MDX
        test/route.ts
        read/route.ts
      generate-image/route.ts        POST — Gemini image gen → Supabase Storage
      gsc/sync/route.ts              POST — sync 7d/28d/90d GSC data
      gsc/properties/route.ts        GET — list GSC properties
      auth/google/                   OAuth initiate / callback / refresh / select-property
      agent-activity/route.ts        POST — log agent_activity row
      briefing-items/route.ts
      clients/[id]/overview/route.ts
      intelligence/decay/            POST — ranking decay detection
      intelligence/score-keywords/   POST — recalculate opportunity scores
      jobs/route.ts / [id]/ / run/   Scheduled jobs CRUD + manual run
      keywords/approve / reject
      notifications/digest / output-ready
      outputs/[id]/route.ts          DELETE
      reports/generate/route.ts
      run-task/route.ts              Queue worker (single task run)
      schedule/check/route.ts        ★ Daily cron: runs jobs, syncs GSC, generates reports, digest
      schedule/run/route.ts
      vercel/promote/route.ts        Full autopilot: promote preview to production
      workspace/api-key/route.ts     Encrypt + save workspace API keys
  components/
    Sidebar.tsx                      ★ Two-level nav: global links + per-agent sub-nav
    StatusBadge.tsx
  lib/
    supabase.ts                      Anon client (client-side)
    workspace.ts                     getWorkspaceId / getOrCreateWorkspace / getWorkspaceName
    crypto.ts                        AES-256-GCM encrypt/decrypt/safeDecrypt
    gsc.ts                           getValidAccessToken(connectionId) — auto-refreshes
    notifications.ts                 sendNotification() — email + Slack + notification_log
    types.ts                         TypeScript types: Output, SiteConnection, OutputImage
    github-commit.ts                 ★ atomicCommit() — Git Trees API multi-file commit
    content-clean.ts                 cleanContent() — em dash / smart quote normalisation
    gsc-keywords.ts                  discoverKeywordsFromGSC() — auto-suggest from GSC data
docs/
  AGENCEE.md                        Full technical reference
  COLLAB.md                         This file — updated each session
vercel.json                         Cron: /api/schedule/check at 07:00 UTC
worker.js                           Standalone worker script
```

---

## Database Schema (all tables)

### Core entities

**`workspaces`** — one per user. `id`, `owner_id`, `name`, `created_at`.

**`workspace_settings`** — `user_id`, `workspace_id`, `anthropic_api_key` (encrypted), `gemini_api_key` (encrypted), `monthly_token_budget`, `tokens_used_this_month`, `onboarding_completed`.

**`agents`** — `id`, `workspace_id`, `name`, `role`, `slug`, `avatar_initials`, `description`, `backstory`, `expertise`, `personality`, `communication_style`, `working_style`, `boundaries`, `instructions`, `agent_type` (`seo`|`technical`), `active`, `nav_items` (jsonb).

`nav_items` shape: `[{"label":"Chat","path":"/agents/[id]","icon":"chat"}, ...]`  
Outputs is a global nav item — NOT in agent nav_items.

**`client_profiles`** — all client data. Key fields:
- Core: `name`, `slug`, `website`, `github_repo`, `github_branch`, `github_token`
- SEO context (in Ada's system prompt): `icp`, `usp`, `brand_voice`, `content_goals`, `content_tone`, `avoid_topics`, `cta_approach`, `pricing_info`, `team_info`, `trust_signals`, `service_differentiators`, `location_info`, `target_keywords`, `schema_type`
- Meta: `ai_overview`, `ai_overview_updated_at`, `content_autonomy` (`manual`|`auto_approve`|`full_autopilot`)

### Content pipeline

**`content_outputs`** — single source of truth for all content. Created by Ada on `write_content`, before any GitHub I/O.
- `agent_type`, `title`, `content` (markdown+frontmatter), `primary_keyword`, `meta_description`, `word_count`
- `format`: `'markdown'` (Ada-written) | `'typescript'` (legacy)
- `images` (jsonb): `[{url, alt_text, filename, storage_path}]` — Supabase Storage URLs
- `approved` (bool), `published_url` (set on publish)
- `platform_output` (jsonb): `{platform, publish_id, committed_at}`
- `source`: `'chat'` | `'scheduled'` | `'queue'`
- `last_edited_at`, `current_version`

**`output_versions`** — version history. Created on each `saveEdit`. `version_number`, `content`, `edited_by` (`human`|`ada`|`system`).

**`content_history`** — published content record for Ada's `search_history` tool. Inserted on approve.

**`content_queue`** — scheduled task queue. `status`: `queued`|`running`|`done`|`failed`|`review`.

**`content_calendar`** — calendar entries. `status`: `planned`|`in_progress`|`published`|`cancelled`.

### SEO data

**`site_pages`** — crawled pages. `url`, `title`, `h1`, `meta_description`, `word_count`, `content`, `content_summary`, `internal_links`.

**`keyword_banks`** — keyword tracking. `keyword`, `cluster`, `intent`, `funnel_stage`, `monthly_volume`, `difficulty`, `current_position`, `opportunity_score` (0–100), `content_targeting_this`.

**`keyword_suggestions`** — Ada-proposed or GSC-discovered keywords awaiting review. `status`: `pending`|`approved`|`rejected`. `source`: `gsc_discovery`|`ada`|`competitor_gap`.

**`search_performance`** — GSC data. Reserved `query` values: `__total__` (aggregate), `__page__` (page-level), `__device__` (device breakdown).

**`briefing_items`** — dashboard cards. `type`: `opportunity`|`decay`|`gap`|`suggestion`|`schedule`. Unique on `(workspace_id, client_id, title)`.

### Infrastructure

**`google_connections`** — GSC OAuth tokens (AES-256-GCM encrypted), `property_url`, `status`.

**`site_connections`** — publish targets. `platform`: `github`|`wordpress`|`shopify`|`webflow`. `config` jsonb holds platform-specific fields.

**`scheduled_jobs`** — job definitions. `job_type`: `gsc_intelligence`|`content`|`keyword_research`|`site_audit`|`custom`. `cadence`: `daily`|`weekly`|`biweekly`|`monthly`.

**`job_runs`** — execution history per job. `status`: `running`|`success`|`failed`.

**`agent_activity`** — log of all agent actions. `action`, `detail`, `tokens_used`.

**`conversations`** / **`messages`** / **`planned_tasks`** — chat state.

**`notification_preferences`** / **`notification_log`** / **`reports`** / **`competitor_sites`** / **`competitor_pages`** / **`content_performance`** / **`client_schedules`** — supporting tables.

**RLS:** All tables scoped to `workspace_id`. Service role (`SUPABASE_SERVICE_KEY`) bypasses RLS in all API routes.

---

## Navigation Structure

```
Sidebar (Sidebar.tsx):
  Dashboard      /
  Clients        /clients
  Outputs        /outputs          ← workspace-level, all agents
  Reports        /reports
  Marketplace    /marketplace
  ─────────────────────
  [Ada]          /agents/[id]      ← avatar header links to chat
    Chat         /agents/[id]
    Queue        /agents/[id]/queue
    Calendar     /agents/[id]/calendar
    Keywords     /agents/[id]/keywords
    Activity     /agents/[id]/activity
  ─────────────────────
  [Theo]         /agents/[id]
    Chat         /agents/[id]
    Publish      /agents/[id]/queue
    Activity     /agents/[id]/activity
  ─────────────────────
  Settings       /settings
```

Nav items come from `agents.nav_items` in DB. Outputs is global — removed from per-agent nav_items in DB (session 2026-06-11).

---

## Agent System

### Two agents

| | Ada | Theo |
|---|---|---|
| `agent_type` | `seo` | `technical` |
| Purpose | SEO strategy, content writing | Publishing, repo management |
| Chat model | `claude-sonnet-4-6` | `claude-sonnet-4-6` |

### Tool access

**Shared tools (both agents):** `search_history`, `get_site_pages`, `get_keywords`, `read_file`, `read_page`, `audit_site`

**Ada-only:** `generate_images`, `write_content`, `save_planned_task`, `update_planned_task`, `suggest_keyword`, `create_content_plan`, `analyse_competitors`, `suggest_internal_links`, `analyse_gsc`

**Theo-only:** `publish_content`, `write_file`

### Ada's system prompt (built in `buildSystemPrompt()` in `agents/[id]/page.tsx`)

Sections (in order):
1. Identity — name, role, backstory, expertise, personality, communication, working style, boundaries
2. WORKING APPROACH — proactive SEO professional, tool call rules, blog post rules, content format, 7-step blog workflow
3. MANDATORY RESEARCH — **before any content answer, Ada MUST call `search_history` + `get_site_pages` + `analyse_gsc` in parallel in a single response.** No content recommendations without all three results. Exception: pure conversational/educational messages.
4. CLIENTS — all client profiles with every non-empty extended field
5. CLIENT DISAMBIGUATION — "Which client is this for?" prompt
6. IMAGE GENERATION — 6 rules for documentary-style images; GOOD/BAD examples
7. CONTENT PLANNING — 3 pieces/week default, 10-14 piece 4-week plan, sequencing rules
8. RESPONSE STYLE + LENGTH

**Not in system prompt:** keyword bank, site pages, content history, GSC raw data — all fetched via tools on demand.

### Agentic loop (`agents/[id]/page.tsx` `send()` function)

1. Insert user message to DB
2. POST `/api/chat` with full message history + tools
3. If `stop_reason === 'tool_use'`: execute all tool blocks in parallel, push results, loop
4. If `stop_reason === 'end_turn'`: save reply via `saveReply()`
5. Loop max 12 iterations

Tool results trimmed to 8000 chars before being stored in history. Large tool inputs (`write_file`, `write_content` content field >2000 chars) trimmed in history too.

### Task log persistence

Task log steps are encoded into assistant message content via `__META__{json}__ENDMETA__\n{content}` prefix. On `loadMessages()`, the last assistant message's `_taskLog` is restored to state. The task log in the sidebar reflects the last completed conversation.

### URL persistence

Active conversation is reflected as `?conversation=[id]`. On page load this param is read and auto-loaded. Selecting or creating a conversation updates URL via `window.history.replaceState`.

---

## Content Pipeline (end-to-end)

```
1. Dan briefs Ada in chat
2. Ada calls generate_images → Supabase Storage blog-images bucket
   Returns: [{ url, filename, alt_text, storage_path }]
3. Ada writes markdown post with YAML frontmatter, embeds Supabase image URLs
4. Ada calls write_content → inserts content_outputs row (approved: false, format: 'markdown')
   Fires output-ready notification (email + Slack)
5. Dan reviews at /outputs/[id] — pipeline: Draft → Approved → Published
6. Dan clicks Approve → approved: true, content_history row inserted
7. Dan clicks Publish → POST /api/connections/publish
8. Publish route:
   a. Downloads each image from Supabase via fetch() → arrayBuffer → base64
   b. Rewrites Supabase URLs → /assets/{filename} in content body
   c. Explicit regex replaces frontmatter image: field if URL not caught by body rewrite
   d. atomicCommit(): MDX to content/posts/{slug}.mdx + images to public/assets/
9. content_outputs.published_url = https://client.website/blog/{slug}
```

**Fallback frontmatter** (if content has no `---` block): publish route builds full YAML from output row fields — all 8 required fields: `title, slug, description, category, reading_time, date, image, image_alt`.

### Platform support

| Platform | How |
|---|---|
| `github` | atomicCommit via Git Trees API (MDX + images) |
| `wordpress` | REST API, images sideloaded to WP media library |
| `shopify` | Articles API, images hotlinked from Supabase |
| `webflow` | Not implemented (501) |

---

## Key Libraries

### `src/lib/github-commit.ts` — `atomicCommit()`

Commits multiple files in one operation. **ALL blobs sent as base64** regardless of content type. Text files: `Buffer.from(content, 'utf8').toString('base64')`. The Git Trees API rejects `encoding: 'utf-8'` — raw text silently corrupts blobs.

Flow: GET ref → GET base tree → POST blobs → POST tree → POST commit → PATCH ref  
Returns: `{ commit_sha }`

### `src/lib/crypto.ts` — AES-256-GCM

`encrypt(text)`, `decrypt(data)`, `safeDecrypt(data)` (returns null on error — always use `safeDecrypt(token) || token` pattern for OAuth tokens in case they're unencrypted).

### `src/lib/content-clean.ts` — `cleanContent()`

Applied before every `content_outputs` insert. Replaces em dashes with commas, normalises smart quotes, collapses 3+ newlines to 2.

### `src/lib/gsc.ts` — `getValidAccessToken()`

Checks `google_connections.token_expires_at`, calls `/api/auth/google/refresh` if expired, returns valid access token.

---

## Publish Route (`/api/connections/publish/route.ts`)

Key details:
- `export const maxDuration = 120` — long timeout for image downloads + commit
- Idempotent: if `output.published_url` already set, returns success immediately
- Token: read from `client_profiles.github_token`, decrypted via `safeDecrypt(rawToken) || rawToken`
- Branch: `config.branch || client.github_branch || 'main'`
- Assets path: `config.assets_path || 'next-public/public/assets'`
- Content path: `config.content_path || 'next-public/content/posts'`
- Image URL rewrite: body split/join + explicit frontmatter regex
- On 401 from GitHub: returns "GitHub token rejected — reconnect in Connections"

---

## Chat API Route (`/api/chat/route.ts`)

Proxies to Anthropic. Loads workspace `anthropic_api_key` (decrypted) — falls back to `process.env.ANTHROPIC_API_KEY`. Logs `agent_activity` row with `tokens_used` (input + output).

---

## Image Generation (`/api/generate-image/route.ts`)

- Model: `gemini-3-pro-image` — **do not change**
- `responseModalities: ['IMAGE', 'TEXT']`
- Extracts `inlineData` from response parts
- Uploads to Supabase Storage `blog-images/{workspace_id}/{client_id}/{slug}.webp`
- Returns `{ url, filename, storage_path }`
- Client-context prompt enhancement injected by the `generate_images` tool handler in `agents/[id]/page.tsx` before calling the API

---

## Scheduled Jobs + Cron

Daily cron at 07:00 UTC (`/api/schedule/check`):
1. Run all enabled `client_schedules` due now → `POST /api/schedule/run`
2. Sync GSC for all connections not synced in 23h → `POST /api/gsc/sync`
3. 1st of month: auto-generate reports for clients with prior-month outputs
4. Run all enabled `scheduled_jobs` due now → `POST /api/jobs/run`
5. Send daily digest → `POST /api/notifications/digest`

Content autonomy modes (per client): `manual` / `auto_approve` / `full_autopilot`

---

## Multi-Tenancy

Every data table has a `workspace_id` FK. RLS policies scope all reads/writes to the owner's workspace. API routes use service key (bypasses RLS) and must filter by `workspace_id` explicitly where needed.

New sign-up: `getOrCreateWorkspace()` seeds workspace + Ada agent + workspace_settings row.

---

## Current Client: Hear Better

- Client ID: `d46432ec-520c-4b16-8752-9b3f3b908f79`
- Website: `https://hearbetternow.co.uk`
- Repo: `github.com/cnvrtagency/wireframe-whisperer-89` (branch: `main`)

**Blog dual-format:**
- Legacy: TypeScript posts in `next-public/content/blogPosts/[slug].tsx` + registry in `blogContent.tsx`
- New (Ada): MDX posts in `next-public/content/posts/[slug].mdx`
- `blog/[slug]/page.tsx` tries MDX first, falls back to TS registry
- `blog/page.tsx` merges both sources by date; MDX wins on collision

**MDX frontmatter contract (8 required fields):**
```yaml
title: "Post Title"
slug: "post-title"
description: "150-160 char meta description"
keyword: "primary target keyword"
category: "Category Name"
reading_time: "8 min read"
date: "YYYY-MM-DD"
image: "/assets/blog-filename.webp"
image_alt: "Descriptive alt text"
```

---

## Design System

CSS custom properties only — no Tailwind. All component styles are inline CSS objects referencing `var(--token)`.

| Token | Value |
|---|---|
| `--bg` | `#F8F9FB` |
| `--surface` | `#FFFFFF` |
| `--surface-2` | `#F2F4F8` |
| `--surface-3` | `#E8ECF2` |
| `--border` | `#E2E6EE` |
| `--border-bright` | `#C8D0E0` |
| `--text` | `#0F1520` |
| `--text-2` | `#5A6A82` |
| `--text-dim` | `#8A9AB2` |
| `--accent` | `#4F7FFF` |
| `--green` | `#0F9D6E` |
| `--amber` | `#D97706` |
| `--red` | `#DC2626` |
| `--purple` | `#7C3AED` |

Fonts: `--font-display` (Instrument Serif italic), `--font-sans` (Inter), `--font-mono` (JetBrains Mono).

---

## Critical Patterns + Gotchas

1. **`safeDecrypt(token) || token`** — always use this pattern for encrypted tokens; older rows may be unencrypted
2. **atomicCommit base64 only** — all blobs base64 regardless of content type, no exceptions
3. **`SUPABASE_SERVICE_KEY`** — not `SERVICE_ROLE_KEY`; wrong name crashes silently
4. **Gemini model** — `gemini-3-pro-image` — locked, do not change
5. **No Tailwind** — inline CSS objects + CSS vars only
6. **maxDuration = 120** on publish route — needed for image downloads + GitHub API calls
7. **Idempotent publish** — publish route returns success immediately if `published_url` already set
8. **Tool result trimming** — results > 8000 chars trimmed before storing in message history
9. **Frontmatter `image:` regex** — applied after body URL rewrite loop in publish route; catches URL format mismatches
10. **Chat bubble filter** — only renders messages with content or the current live placeholder; empty assistant messages hidden
11. **Task log encoding** — stored as `__META__{json}__ENDMETA__\n{content}` in message rows; decoded by `decodeMessageMeta()`
12. **Content cleanup** — always run `cleanContent()` before inserting to `content_outputs`

---

## GSC Integration

**Opportunity scoring** (`opportunity_score` 0–100):
- Base 50; GSC position ≤10 → +10, ≤20 → +30; volume >1000 → +20; KD <20 → +15; has targeting content → -25

**Keyword discovery** thresholds: > 5 impressions; no candidate cap; rejects excluded permanently.

**Near-miss briefing items**: position 3–20, > 15 impressions → upserted as `opportunity` type.

**Ada's `analyse_gsc` tool**: returns near-misses, low-CTR opportunities, top queries, summary stats in JSON. Ada receives this on demand — not in system prompt.

---

## Session Change Log

### 2026-06-11 — Production Deploy + Frontmatter Repair

**Files changed:**
- `vercel.json` — cron schedule finalised at `0 7 * * *` (Hobby plan; `*/15` requires Pro)
- `src/app/api/schedule/check/route.ts` — added `Authorization: Bearer` auth alongside legacy `x-cron-secret`

**What happened:**
- Deployed to Vercel at **https://agencee.vercel.app** (team: `liam-hobson-s-projects`)
- 13 env vars set on Vercel production (all from `.env.local`)
- Cron registered at 07:00 UTC daily — confirmed via `GET /api/schedule/check` → `200 {"triggered":0}`
- Repair route ran: patched `microsuction-near-me-north-east.mdx` (missing `image:` field). `microsuction-near-me-what-it-is-how-it-works-at-home.mdx` already had correct frontmatter.

**Still needed:**
- Add `https://agencee.vercel.app/api/auth/google/callback` to Google Cloud Console OAuth redirect URIs (required for GSC reconnect in production)
- `RESEND_API_KEY` not in `.env.local` — notification emails will fail silently until set
- Cron plan: Hobby = daily only. Upgrade to Vercel Pro if `*/15` schedule is needed.

---

### 2026-06-11 — Frontmatter Image Fix

**Files changed:**
- `src/app/api/connections/publish/route.ts` — 2 changes
- `src/app/api/repair/frontmatter-images/route.ts` — new file

**What changed and why:**

| Section | Change | Why |
|---|---|---|
| Publish route — image frontmatter | Replaced single backup regex with 3-step guard that handles: URL mismatch (existing), empty/wrong value, missing field entirely | Confirmed `microsuction-near-me-...mdx` published with no `image:` field — Ada sometimes writes frontmatter without it; old regex only fixed URLs that were already there |
| Publish route — `platform_output` | Added `hero_image_path: "/assets/<filename>"` to the `platform_output` jsonb saved on publish | Field was missing; output detail page had no way to show the resolved `/assets/` path post-publish |
| Repair route — one-off fix | `GET /api/repair/frontmatter-images?dry_run=true` audits all published GitHub posts; `POST /api/repair/frontmatter-images` patches affected MDX files in-place via atomic commit | Required to fix `microsuction-near-me-...mdx` and any other posts published before this fix |

**To run the one-off repair:**
1. `GET /api/repair/frontmatter-images` — dry run, returns list of posts that would be patched
2. `POST /api/repair/frontmatter-images` — commits the fix to GitHub for each affected post

---

### 2026-06-11 — UX Fixes Pass

**Files changed:**
- `src/app/(app)/agents/[id]/page.tsx` — 3 changes
- `src/app/api/connections/publish/route.ts` — 1 change
- `src/components/Sidebar.tsx` — 1 change
- `src/app/(app)/outputs/page.tsx` — 1 change
- `docs/AGENCEE.md` — updated navigation, agent system, outputs list sections
- `docs/COLLAB.md` — this file (created)

**What changed and why:**

| Section | Change | Why |
|---|---|---|
| Ada research-first | Replaced `PROACTIVE GSC ANALYSIS` block with `MANDATORY RESEARCH` block in `buildSystemPrompt()` | Ada was giving content recommendations without checking existing content or performance first |
| URL + task log persistence | `loadMessages()` now reads `?conversation=` on page load and restores task log from last message's `_taskLog` | Task log reset to empty on every page refresh; conversation not bookmarkable |
| Message filtering | Chat render filters out empty assistant messages; only shows messages with content or current live placeholder | Empty bubbles (`...`) appearing for tool-use intermediate states in historical conversations |
| Frontmatter image fix | Explicit regex replacement of `image:` field in publish route after URL rewrite loop | Frontmatter `image:` could retain Supabase URL if it didn't match `img.url` verbatim |
| Outputs global nav | Added `Outputs` to Sidebar global nav (between Clients and Reports) | No direct link to outputs from main nav — had to go through agent sub-nav |
| Agent column in outputs | Added agent (Ada/Theo) column to `/outputs` list | No way to see which agent produced each output |
| Remove Outputs from agent nav | Updated `agents.nav_items` in DB to remove `Outputs` item from both Ada and Theo | Outputs is now workspace-level; per-agent outputs links no longer needed |

**Previous session (MDX migration + content pipeline):**
- Fixed Hear Better build (literal `\n` in `.tsx` blog post file)
- MDX migration: `mdxPosts.ts`, updated `blog/[slug]/page.tsx` and `blog/page.tsx`
- Patched fallback frontmatter to include all 8 required fields
- Updated `docs/AGENCEE.md` comprehensively

---

## What's Not Done / Known Gaps

- Webflow publishing — 501 stub only
- `content_performance` table — schema exists but no data collection UI
- `pdf_url` on reports — not implemented
- `analyse_gsc` thresholds in `agents/[id]/page.tsx` differ slightly from GSC sync thresholds (positions 5–15 in tool vs 3–20 in sync) — not a bug but worth noting
- `agents/[id]/outputs/page.tsx` still exists as a route (not removed) — now orphaned since nav link is gone
- No per-tool `conversation_id` logging in `agent_activity` (task log lives only in message `__META__` encoding)
- ~~One-off repair~~ **Done** — `POST /api/repair/frontmatter-images` ran on 2026-06-11; patched `microsuction-near-me-north-east.mdx`
- `RESEND_API_KEY` not set — notification emails will fail silently until added to Vercel env vars
- Google OAuth redirect URI needs adding in Google Cloud Console for production GSC reconnect
