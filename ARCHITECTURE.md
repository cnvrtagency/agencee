# Agencee — Master Architecture Document

**Living document. Update at the end of every build session.**
Last updated: 11 June 2026. Session: full system stabilisation audit, API auth/cost hardening, Usage page, cron/queue safeguards.

---

## What Agencee is

Internal AI agent SaaS for CNVRT (Dan's Manchester digital agency). AI agents handle SEO strategy, content production, keyword planning, site analysis, and publishing for clients. Eventually reseller-ready. Not currently client-facing.

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind v4 in globals.css only. All components use inline styles. Do not add Tailwind classes to JSX. |
| Database | Supabase (Postgres + Storage) |
| Primary AI | Anthropic — Sonnet 4.6 (agents, calendar planning, reports), Haiku 4.5 (utility calls) |
| Image AI | Gemini 3 Pro Image / Nano Banana Pro (`gemini-3-pro-image`) |
| Publishing | GitHub MDX + Vercel, WordPress, Shopify, Webflow |
| Notifications | Resend (email) + Slack webhooks |
| Cron | Vercel cron daily 07:00 UTC → `/api/schedule/check` |
| Hosting | Vercel (app) + Railway (worker) |
| App repo | github.com/cnvrtagency/agencee |
| Hear Better repo | github.com/cnvrtagency/wireframe-whisperer-89 |

---

## Agents

### Ada — SEO Specialist
**agent_type:** `seo` | **DB agent_id:** `1300a385-17d3-41e1-9535-50f5b9c49823`

Ada is the primary content and SEO strategy agent. She plans, researches, writes, analyses, and saves drafts for human review.

#### What Ada can do

| Capability | How it works |
|---|---|
| Keyword gap analysis | Cross-references keyword bank + knowledge panel site pages + content history. Flags data conflicts. Reports genuine gaps only. |
| GSC performance analysis | Calls `analyse_gsc` for live data. Knowledge panel snapshot provides baseline without a tool call. Returns near-misses, low-CTR pages, top queries, click/impression totals. Also runs `discoverKeywordsFromGSC` to suggest new keywords on every analyse_gsc call. |
| Blog post writing | Full markdown + YAML frontmatter. Title tag, meta description, keyword placement, location terms, internal links, FAQ with JSON-LD schema, credentialed practitioner for health content. 2-4 images. |
| Image generation | Calls `generate_images` (single array call) AFTER writing the post. SCHEMA-structured prompts (Subject/Context/Lighting/Atmosphere/Camera/Style/Mandatory/Prohibitions) derived from actual post content and client profile. 1K resolution default. |
| Site audit | `audit_site` checks crawled pages for: missing meta descriptions, missing H1s, thin content (<300w), keyword cannibalisation (pages targeting >3 keywords), untargeted keywords. |
| Competitor analysis | `analyse_competitors` reads `competitor_sites` and `competitor_pages`. Returns per-site summaries with Haiku-generated content summaries and a basic gap analysis comparing competitor topics to client site pages. |
| Content planning | `create_content_plan` inserts to `content_calendar`. The calendar generator route (`/api/calendar/generate-plan`) is the preferred path — one Sonnet call with full context. |
| Internal link suggestions | `suggest_internal_links` after every `write_content`. Scores existing pages by keyword relevance, returns top 5. Creates a briefing_item for the user. |
| Keyword suggestions | `suggest_keyword` adds to `keyword_suggestions` table (pending, awaiting user approval). |
| Read/write files | `read_file` and `write_file` for direct GitHub repo operations. |
| Save planned tasks | `save_planned_task` / `update_planned_task` to `planned_tasks` table. Shown in the agent sidebar. |
| Agent notes | `update_agent_notes` writes to `client_knowledge.agent_notes[agent.slug]`. Persists across sessions. |
| Suggested replies | When Ada ends with a question or options, she appends `<suggestions>["a","b","c"]</suggestions>` — parsed by the UI into clickable chips. |

#### Ada's workflow — blog post

1. **Acknowledge** (brief, 1 sentence, Haiku)
2. Call `search_history` + `get_keywords` in parallel — check coverage, find best untargeted keyword
3. Knowledge panel provides site pages — no tool call needed
4. Write the complete markdown post with frontmatter
5. Call `generate_images` with SCHEMA prompts derived from the post content
6. Call `write_content` — saves to `content_outputs`, updates `keyword_banks.content_targeting_this`, fires output-ready notification
7. Call `suggest_internal_links` for the new page — creates briefing_item

#### Ada's workflow — keyword gap analysis

1. **Acknowledge**
2. Call `get_keywords` + `search_history` in parallel
3. Cross-reference against knowledge panel site pages (no tool call — already in context)
4. Reconcile all three before drawing conclusions — never claim a keyword is untargeted without checking all sources
5. Return ranked gaps with angles, sequenced by commercial impact

#### Ada's system prompt structure

1. Identity (name, role, backstory, expertise, personality, communication style, working style, boundaries, custom instructions from DB)
2. Universal working principles (research-first, data reconciliation rule, acknowledgement behaviour, suggested replies format)
3. Client context (all profile fields, dynamically from DB — no hardcoding)
4. Knowledge panel (site_pages, gsc_snapshot, content_summary, agent_notes)
5. SEO-specific instructions: working approach, blog post rules, content format, workflow, content planning rules
6. Image generation: SCHEMA methodology, content-derived prompts, 1K default
7. Response style: conversational, UK English, zero em-dashes, length rules, suggested replies, acknowledgement format

**Note:** The system prompt in `buildSystemPrompt()` is NOT yet updated to the overhaul spec. It still has the old hardcoded Hear Better image rules and the old three-tool mandatory research block. The overhaul prompt was written but may not have been fully applied. Verify before next session.

#### Ada's tool access

All tools available. `getToolsForAgent()` currently still uses the old filter logic (SHARED + ADA names). The overhaul prompt specified making all tools available to all agents — verify this was applied.

Current effective tool list for Ada:
`write_content`, `generate_images`, `save_planned_task`, `update_planned_task`, `suggest_keyword`, `create_content_plan`, `analyse_competitors`, `suggest_internal_links`, `analyse_gsc`, `search_history`, `get_site_pages`, `get_keywords`, `read_file`, `read_page`, `audit_site`, `update_agent_notes`

#### Ada's known gaps

- No proactive analysis between sessions (cron doesn't trigger Ada to write briefing items autonomously)
- No content performance feedback loop (doesn't know GSC data for published posts)
- No cross-conversation memory beyond agent_notes
- Em-dashes still appearing in responses despite system prompt rule
- Task log panel shows raw JSON/code during Working... state (UI bug)
- Thoughts captured but only shown in a truncated block — not surfaced clearly

---

### Theo — Technical SEO & Publisher
**agent_type:** `technical` | **slug in DB:** `technical` (not `theo`)

Theo reads approved drafts and publishes them to client platforms.

#### What Theo can do

| Capability | How it works |
|---|---|
| Publish to GitHub | Commits images to `/public/assets/`, commits MDX file with `/assets/` image paths, triggers Vercel deploy |
| Publish to WordPress | Via site_connections config |
| Publish to Shopify | Via site_connections config |
| Publish to Webflow | Via site_connections config |
| Image frontmatter | Injects `image:` and `image_alt:` into MDX frontmatter on publish |
| Read/write files | `read_file`, `write_file` for direct repo operations |

#### Theo's workflow — publish

1. Verify `content_outputs.approved = true` (returns error if not)
2. Load `site_connections` for the client
3. Call `publish_content` → `/api/connections/publish`
4. Images committed to GitHub `/public/assets/` first
5. MDX committed with `/assets/filename` paths in frontmatter
6. Vercel deploy triggered
7. `content_outputs.published_url` set
8. `keyword_banks.content_targeting_this` updated to live URL
9. Live URL reported back

#### Theo's tool access
`publish_content`, `write_file`, `read_file`, `get_site_pages`, `search_history`, `get_keywords`, `audit_site`, `read_page`

---

### Marketplace agents (not yet built)

Exist as cards in `/marketplace` only. No agent_type, tools, or system prompt.

| Name | Intended role |
|---|---|
| Leo | Link building and outreach |
| Iris | Analytics interpretation (GSC + GA4) |
| Scout | Competitor intelligence and monitoring |
| Ellie | E-commerce copywriting (Shopify/WooCommerce) |
| Theo (marketplace) | Technical SEO auditor — separate from publisher Theo |

---

## All Tools (ALL_TOOLS in agents/[id]/page.tsx)

| Tool | Handler location | What it does | Side effects |
|---|---|---|---|
| `write_content` | agents/[id]/page.tsx | Inserts to `content_outputs`. Fires output-ready notification. Logs to `agent_activity`. | Updates `keyword_banks.content_targeting_this`. Sets `pendingDraftCardRef` for draft card UI. |
| `publish_content` | agents/[id]/page.tsx | Calls `/api/connections/publish`. Checks output is approved. | Updates `published_url`. Updates `keyword_banks.content_targeting_this` to live URL. |
| `generate_images` | agents/[id]/page.tsx | Parallel calls to `/api/generate-image`. Enhances prompts with client style context. | Uploads to Supabase Storage `blog-images` bucket. Returns public URLs. |
| `save_planned_task` | agents/[id]/page.tsx | Inserts to `planned_tasks`. | Reloads `plannedTasks` state. |
| `update_planned_task` | agents/[id]/page.tsx | Updates `planned_tasks` row. | Reloads `plannedTasks` state. |
| `read_file` | agents/[id]/page.tsx | GET `/api/github?client_id=&path=` | None |
| `audit_site` | agents/[id]/page.tsx | Reads from `sitePages` state (loaded at session start). Checks: missing meta, missing H1, thin content, cannibalisation, untargeted keywords. | None |
| `read_page` | agents/[id]/page.tsx | Reads from `site_pages` table by URL. Returns url, title, H1, meta, word_count, internal_links, full content. | None |
| `search_history` | agents/[id]/page.tsx | Reads `content_history` table. Filters by query match on title/keyword/summary. | None |
| `write_file` | agents/[id]/page.tsx | PUT `/api/github`. Also inserts to `content_outputs` and `content_history`. | Fires output-ready notification. |
| `get_site_pages` | agents/[id]/page.tsx | Reads from `sitePages` state. Keyword-filters to top 10 relevant. Supports filter: all/no_meta/no_h1/thin. | None |
| `get_keywords` | agents/[id]/page.tsx | Reads `keyword_banks` ordered by `opportunity_score` desc. Supports filter: all/untargeted/ranking/high_volume. | None |
| `suggest_keyword` | agents/[id]/page.tsx | Inserts to `keyword_suggestions` (status: pending). | Logs to `agent_activity`. |
| `create_content_plan` | agents/[id]/page.tsx | Inserts to `content_calendar`. | Logs to `agent_activity`. |
| `analyse_competitors` | agents/[id]/page.tsx | Reads `competitor_sites` and `competitor_pages`. | Logs to `agent_activity`. Upserts result to `client_knowledge.agent_notes.competitor_analysis` (capped at 4000 chars) with timestamp. |
| `suggest_internal_links` | agents/[id]/page.tsx | Scores existing `sitePages` state by keyword relevance. Returns top 5. | Creates `briefing_item`. Logs to `agent_activity`. |
| `analyse_gsc` | agents/[id]/page.tsx | Reads `search_performance` table. Returns near-misses (pos 5-15, >50 imp), low-CTR, top queries, totals. | Runs `discoverKeywordsFromGSC` — may add to `keyword_suggestions`. |
| `update_agent_notes` | agents/[id]/page.tsx | Upserts to `client_knowledge.agent_notes[agent.slug]`. | None |
| `web_search` | Anthropic native (web_search_20250305) | Searches the web for current information — rankings, algorithm changes, competitor content, industry trends. Requires `web-search-2025-03-05` beta header. Handled server-side by Anthropic; results returned as `web_search_tool_result` blocks in the same response, not as a custom tool call. SEO agents only (not Theo). | None — results flow through the agentic loop automatically. |

---

## Agentic loop (send() function)

- Max 12 iterations
- Each iteration: POST `/api/chat` → Anthropic API
- On `tool_use`: all tool blocks executed in **parallel** via `Promise.all`
- Tool inputs with large content (write_file, write_content) trimmed to 2000 chars before pushing to history
- Tool results trimmed to 8000 chars max before pushing to history
- Thinking text (pre-tool text blocks) captured to `thoughtsRef` and shown in task log
- On `end_turn` with empty reply: fires a summary request (Haiku, 512 tokens) asking Ada to summarise what she just did
- On `max_tokens`: saves partial + "Reply 'continue' to get the rest"
- Task log: persists across navigation via `encodeMessageMeta` / `decodeMessageMeta` in message content
- `pendingDraftCardRef`: holds draft card data (title, word count, image count, review URL) set by write_content, attached to the final assistant message
- **Conversation summarisation:** when `rawMessages.length > 8`, all but the last 6 messages are summarised into a single Haiku call (max 600 tokens) and replaced with a 2-message `[Earlier in this conversation] / Summary: ...` block. Keeps input tokens bounded on long sessions. Falls back to full history if the Haiku call fails.

---

## Pages

### App pages (`src/app/(app)/`)

| Route | What it does |
|---|---|
| `/` | Dashboard. Briefing room (AI opportunity cards, expand/collapse, Act/Dismiss). Stat cards (Clients, Queued, Running, Needs review — mono font, 36px number). What needs attention panel. Token usage (by agent + 5-week activity calendar). Pending review (inline approve/delete). Queue activity. |
| `/clients` | Client list table. Add client modal (name, website, industry, slug — minimal). Saves immediately, redirects to client detail page to complete profile. |
| `/clients/[id]` | 10 tabs: Profile, Keywords, Pages, Codebase, Connections, Schedule, Competitors, Search, Reports, Knowledge. AI overview panel (Haiku, 24h cache). Crawl button. GSC sync button. Refresh knowledge panel button. Knowledge tab: shows Ada's notes (last_conversation, recommendations, pending, history from `client_knowledge.agent_notes`), content summary (`client_knowledge.content_summary`), and manual docs (`client_knowledge.docs`). All three sections loaded from client_knowledge on mount. Reads `?tab=` and `?gsc=` URL params on mount for OAuth redirect handling. |
| `/clients/[id]/gsc-setup` | Google OAuth for GSC connection |
| `/outputs` | Global outputs — Drafts/Approved/Published tabs. Thumbnail, title, client, keyword, agent, word count, date, status pill, action buttons (Approve, Review, Publish, View live). |
| `/outputs/[id]` | Full output detail. Pipeline bar (Draft/Approved/Published). Image gallery with Supabase URLs. SEO metadata bar (title char count, meta char count). Preview/Edit toggle. 12 feedback preset chips (Generate images, Add TOC, Strengthen intro, Fix title/meta, Featured snippet, Internal links, Improve CTA, FAQ section, Expand, Fix headings, Strengthen trust signals, Adjust tone). Feedback to Ada panel. Version history. Approve/Revert/Publish/Delete. |
| `/keywords` | Global keyword suggestions. Pending/Approved/Rejected tabs. Client filter. Importance stars (scored from GSC position + impressions). Approve all. Per-row approve (→ keyword_banks) / reject with reason input. |
| `/reports` | Reports list. Generate modal (client + period_start + period_end). |
| `/queue` | Global content queue |
| `/usage` | Workspace usage dashboard. Month spend estimate, token budget, route/action breakdown, recent activity, and protection status. Reads authenticated workspace activity and uses shared model pricing estimates. |
| `/activity` | Global agent activity log |
| `/calendar` | Global content calendar (separate from per-agent) |
| `/marketplace` | Agent cards. Ada + Theo installed. 5 others not installed. |
| `/settings` | Workspace name, Anthropic key, Gemini key, token budget + usage bar, notification prefs (email toggle, Slack webhook + test button, per-type toggles). |
| `/agents` | Agent list |
| `/agents/[id]` | Main agent interface. Chat + Settings tabs. Left panel: New chat, task log (Active/Last session), planned tasks, conversation list with delete. Right panel: agent header with avatar/name/role + live session cost (tokens + est. $, resets per conversation), message thread, quick action chips (empty state), suggested reply chips (after ambiguous responses), textarea + Send. |
| `/agents/[id]/overview` | Agent profile dashboard. Avatar, name, role, description, "Chat with" CTA. Stats row (conversations, drafts, keywords, tokens this week/month, total cost est.). Client knowledge panel (page count, GSC data, docs, agent notes per client, link to edit). Current SEO intelligence digest (latest week). Automations status (dot + last run time per automation). Recent activity feed (last 8 actions). All figures marked (est.) for cost. |
| `/agents/[id]/automations` | Standalone automations page. Moved from tab on agent page. Toggle on/off, cadence display, last/next run time, run now button. Seeds 6 defaults on first load. |
| `/agents/[id]/calendar` | Per-agent calendar. Generator panel (client, 2w/4w/8w, 1-4 posts/week, optional focus, "Generate plan" button). Month grid view (chips on dates, drawer on click). List view toggle. Status flow bar. Unscheduled strip. Bulk approve/schedule bar. |
| `/agents/[id]/keywords` | Per-agent keyword suggestions with importance scoring |
| `/agents/[id]/outputs` | Per-agent outputs — Needs review / Approved |
| `/agents/[id]/queue` | Per-agent queue. Status filters. Clear queue. Remove individual items. |
| `/agents/[id]/activity` | Day-grouped activity log. Token count + estimated cost ($4/M blended). Pagination. |

### Auth pages

| Route | Purpose |
|---|---|
| `/login` | Supabase email/password. Brand green background (#063227). AgenceeLogo animated. White card form. |
| `/signup` | Account creation |
| `/onboarding` | Post-signup setup |

---

## API Routes

### API auth and cost contract

- Browser `/api/*` calls are authenticated by `AuthenticatedFetch`, which attaches the current Supabase access token as `Authorization: Bearer <token>`.
- Server routes use shared guards from `src/lib/server/auth.ts`:
  - `requireUser` for normal user actions.
  - `requireUserOrInternal` for routes callable by either a logged-in user or cron/worker.
  - `requireInternal` for internal-only maintenance routes.
- Cron and server-to-server subrequests use `Authorization: Bearer ${CRON_SECRET}`. If `CRON_SECRET` is missing, internal-only routes fail closed.
- Routes using the service-role client must still verify client/workspace ownership before reading or mutating tenant data.
- Expensive AI routes use shared rate limiting and budget checks where practical. Token/cost accounting is centralised server-side in `src/lib/server/token-usage.ts`.
- Google OAuth start/callback are the exception because they are browser navigation and provider callback endpoints. State signing remains an open hardening task.

### Agents and content

| Route | Method | Purpose | Notes |
|---|---|---|---|
| `/api/chat` | POST | Anthropic API proxy. Accepts model, messages, tools, system. | All agent tool calls go through here. |
| `/api/run-task` | POST | Autonomous content gen for queued items. Single Sonnet call, no tools. Loads knowledge panel, content history, site pages, keyword bank in parallel before calling Sonnet. | Full system prompt with client context, GSC snapshot, live pages, keyword bank, and content history. max_tokens: 12000. |
| `/api/generate-image` | POST | Image gen → Supabase Storage blog-images bucket. Default 1K. Model fallback: `gemini-3-pro-image` → `gemini-2.0-flash-preview-image-generation` → `imagen-3.0-generate-002`. Missing GEMINI_API_KEY returns 200 `skipped:true` instead of 500. | Returns url, filename, storage_path, mime_type. |
| `/api/intelligence/ada-briefing` | POST | Ada creates proactive briefing items after analysis. Body: `{ client_id, agent_id?, items: [{ type, title, body, priority }] }`. Loads workspace_id from client_profiles, upserts briefing_items with workspace_id, logs agent_activity. |

### Scheduling and jobs

| Route | Method | Purpose |
|---|---|---|
| `/api/schedule/check` | GET | Vercel cron entry. Triggers due client_schedules, GSC syncs, monthly reports, scheduled_jobs, daily digest. Requires x-vercel-cron-signature or Bearer CRON_SECRET. |
| `/api/schedule/run` | POST | Execute one client_schedule: pick untargeted keyword by priority → content_queue → update next_run_at. |
| `/api/jobs` | GET/POST | List or create scheduled_jobs. |
| `/api/jobs/run` | POST | Run a scheduled_job. Types: gsc_intelligence, keyword_research, content, site_audit. |
| `/api/jobs/[id]` | POST | Update/delete a job. |

### Intelligence

| Route | Method | Purpose |
|---|---|---|
| `/api/intelligence/decay` | POST | Compare 28d vs 56d GSC data. Flag keywords dropped >3 positions with >50 impressions → briefing_items + agent_activity. |
| `/api/intelligence/score-keywords` | POST | Recalculate opportunity_score for all keyword_banks rows (position + volume + KD + content_targeting_this). |
| `/api/intelligence/run-automation` | POST | Executes one agent automation by type. Returns `{ ok, summary }`. Called by the Automations page "Run now" button and by cron. **Handlers:** `weekly_keyword_scan` — reads `keyword_banks` using `monthly_volume`+`opportunity_score`, creates briefing_item for top gap. `gsc_review` — fetches `google_connections` (active), calls `/api/gsc/sync` per connection, reports briefing items created. `internal_link_audit` — reads `site_pages.internal_links` (jsonb array), flags pages with <2 links and >300 words. `site_audit` — crawls site, analyses pages for missing meta/H1/thin content, creates briefing_item. `competitor_analysis` — reads `competitor_sites` table (NOT `client_profiles.competitors`), crawls each site via `/api/crawl`. `monthly_content_plan` — calls `/api/calendar/generate-plan` with 4 weeks, 2 posts/week. |
| `/api/intelligence/knowledge-digest` | POST | Searches the web for current SEO developments via native web_search tool, summarises with Sonnet, stores in `agent_knowledge`. Runs Mondays via cron. Deduplicates by week — skips if row already exists for current week. Agentic loop handles web search turns (max 6 iterations). |

### Knowledge and clients

| Route | Method | Purpose |
|---|---|---|
| `/api/crawl` | POST | Crawl client website → site_pages → client_knowledge (site_pages, site_summary, content_summary via Haiku). Competitor mode now generates Haiku content summaries for each crawled page (capped at 20). **Sitemap-first:** tries /sitemap.xml then /sitemap_index.xml (+ sub-sitemaps, max 5) before link crawling. Falls back to link crawling from homepage if no sitemap found. Uses Chrome browser UA. When sitemap mode active, link extraction inside the crawl loop is skipped. |
| `/api/gsc/sync` | POST | Full GSC sync: 7d/28d/90d → search_performance, keyword position updates, briefing_items, client_knowledge gsc_snapshot. |
| `/api/gsc/properties` | GET | List GSC properties for a Google account. |
| `/api/knowledge/[clientId]` | GET/PATCH | Read or upsert client_knowledge panel. |
| `/api/calendar/generate-plan` | POST | Load full client context (knowledge panel + keyword bank + content history + existing plan + competitor pages with summaries) → one Sonnet call → JSON plan → insert to content_calendar. Upgraded prompt — near-miss analysis, featured snippet gaps, competitor gaps, cannibalisation detection, topical authority gaps. Returns intelligence_notes for proactive findings. |
| `/api/clients/[id]/overview` | POST | Haiku AI overview for client (24h cache). Uses GSC totals + content stats. |
| `/api/keywords/approve` | POST | Approve keyword_suggestion → insert to keyword_banks. Rounds float positions. |
| `/api/keywords/reject` | POST | Reject a keyword_suggestion. |
| `/api/keywords/backfill-targeting` | POST | Haiku semantic match: untargeted keywords → live site pages → update content_targeting_this. Validates URLs against site_pages. |

### Publishing

| Route | Method | Purpose |
|---|---|---|
| `/api/connections/publish` | POST | Publish approved content_output. GitHub: commit images + MDX, inject image frontmatter, trigger Vercel. WordPress/Shopify/Webflow via config. Updates keyword_banks.content_targeting_this to live URL. |
| `/api/connections/read` | GET/POST | Read content from site connection. |
| `/api/connections/test` | POST | Test a site connection. |
| `/api/outputs/[id]` | POST | Update output (approve, edit). |
| `/api/repair/frontmatter-images` | POST | One-off: fix missing image: fields in published MDX. |

### Auth

| Route | Purpose |
|---|---|
| `/api/auth/google` | Initiate Google OAuth |
| `/api/auth/google/callback` | OAuth callback, store tokens |
| `/api/auth/google/refresh` | Refresh access token |
| `/api/auth/google/select-property` | Save selected GSC property |

### Other

| Route | Method | Purpose |
|---|---|---|
| `/api/agent-activity` | GET/POST | Log or list agent_activity. GET supports agent_id, client_id, page, page_size, totals_only. |
| `/api/briefing-items` | GET/POST | List (with dismissed filter) or dismiss (single or bulk) briefing_items. |
| `/api/notifications/digest` | POST | Daily digest per workspace: draft count + keyword suggestions + next schedule → email + Slack. |
| `/api/notifications/output-ready` | POST | Fire when a draft is ready for review. |
| `/api/reports/generate` | POST | Monthly report: loads content_outputs, search_performance, keyword_banks, agent_activity → Sonnet executive summary → stored in reports table. |
| `/api/github` | GET/PUT | GitHub API proxy for read_file (GET) and write_file (PUT). |
| `/api/clients/[id]/github` | GET/POST | GitHub-specific client operations. |
| `/api/vercel/promote` | POST | Promote a Vercel deployment. |
| `/api/workspace/api-key` | POST | Save encrypted API keys to workspace_settings. |

---

## Database Tables

| Table | Key columns | Purpose |
|---|---|---|
| `workspaces` | id, owner_id, name | One per account |
| `workspace_settings` | user_id, anthropic_api_key, gemini_api_key, monthly_token_budget, tokens_used_this_month | API keys + usage |
| `client_profiles` | id, name, slug, website, description, icp, usp, brand_voice, content_goals, content_tone, location_info, competitors[], github_repo, content_autonomy, pricing_info, team_info, trust_signals, service_differentiators, target_keywords, avoid_topics, cta_approach, schema_type, ai_overview, ai_overview_updated_at | All client context |
| `client_knowledge` | client_id, site_pages jsonb, site_pages_updated_at, site_summary, gsc_snapshot jsonb, gsc_snapshot_updated_at, content_summary, content_updated_at, docs jsonb, agent_notes jsonb | Persistent client brain. `agent_notes[slug]` is a structured object: `{ last_conversation: { summary, recommendations, pending }, history: [{ date, summary, recommendations, pending }] }` (max 10 history entries). Also has `competitor_analysis: { updated_at, result }` key. |
| `client_schedules` | client_id, agent_id, cadence, content_types[], target_word_count, next_run_at, last_run_at | Recurring content schedules |
| `agents` | id, name, role, slug, agent_type, avatar_initials, instructions, backstory, expertise, personality, communication_style, working_style, boundaries, nav_items, active | Agent config |
| `conversations` | id, agent_id, title, updated_at, user_id | Chat sessions |
| `messages` | conversation_id, role, content, user_id | Content has __META__ prefix encoding task log + thoughts |
| `planned_tasks` | agent_id, client_id, conversation_id, content_type, primary_keyword, supporting_keywords, title_brief, word_count, internal_links, notes, status | Agent-saved planned content |
| `content_queue` | client_id, user_id, agent_type, content_type, primary_keyword, supporting_keywords, word_count, scheduled_for, status, tokens_used, output_id, error, started_at, completed_at, calendar_id, notes, updated_at | Job queue. Live schema was missing several runtime columns during the 11 Jun 2026 audit; see migration `20260611_queue_runtime_columns.sql`. |
| `content_outputs` | client_id, title, content, primary_keyword, meta_description, word_count, approved, published_url, images jsonb, platform_output jsonb, format, source, notes, current_version | All drafts/published |
| `content_history` | client_id, title, url, primary_keyword, summary, published_at, ranking_position, ranking_date, traffic_notes, performance_notes | Published content record |
| `content_calendar` | client_id, title, primary_keyword, content_type, scheduled_date, status, rationale, priority, agent_id, notes, output_id, queue_item_id | Calendar planning |
| `keyword_banks` | client_id, keyword, intent, funnel_stage, monthly_volume, difficulty, current_position, content_targeting_this, opportunity_score, priority | Approved keyword targets |
| `keyword_suggestions` | client_id, keyword, rationale, source, metadata jsonb, status, suggested_by, monthly_volume_estimate, difficulty_estimate, intent, funnel_stage | Pending keyword proposals |
| `search_performance` | client_id, query, page, position, impressions, clicks, ctr, period_start, period_end | GSC data. __total__/__page__/__device__ special rows for aggregates. |
| `content_performance` | client_id, url, keyword, impressions, clicks, position, recorded_at | Per-URL GSC snapshots |
| `site_pages` | client_id, url, title, h1, meta_description, word_count, content_summary, content, internal_links, crawled_at | Crawled page inventory |
| `competitor_sites` | client_id, url, name, notes, last_crawled_at | Competitor records |
| `competitor_pages` | competitor_id, client_id, url, title, h1, word_count, keywords[], content_summary | Crawled competitor content |
| `google_connections` | client_id, property_url, access_token, refresh_token, last_synced_at, status | GSC OAuth |
| `site_connections` | client_id, platform, label, config, status, last_tested_at | GitHub/WordPress/Shopify/Webflow |
| `briefing_items` | client_id, workspace_id, type, title, body, action_url, action_label, priority, dismissed | Dashboard intelligence cards |
| `agent_activity` | agent_id, client_id, workspace_id, action, detail, tokens_used | Agent action log |
| `notification_preferences` | workspace_id, email_enabled, slack_webhook_url, notify_output_ready, notify_ranking_changes, notify_schedule_complete, notify_schedule_failed, notify_ranking_threshold | Notification config |
| `notification_log` | workspace_id, type, subject, body, channels[], sent_at | Sent notification history |
| `reports` | client_id, period_start, period_end, status, data jsonb | Monthly reports |
| `scheduled_jobs` | client_id, workspace_id, agent_id, name, job_type, cadence, run_day, run_hour, next_run_at, last_run_at, last_run_status, last_run_summary, enabled | Background jobs |
| `job_runs` | job_id, workspace_id, client_id, status, summary, completed_at | Job execution history |
| `agent_automations` | agent_id, automation_type, name, description, enabled, cadence, run_day, run_hour, last_run_at, last_run_status, last_run_summary, next_run_at, config jsonb | Per-agent background tasks. 6 defaults seeded on first load: weekly_keyword_scan, monthly_content_plan, competitor_analysis, site_audit, gsc_review, internal_link_audit. UNIQUE(agent_id, automation_type). |
| `agent_knowledge` | agent_type, week_of, summary, sources[] | Global SEO intelligence digest. Written weekly by `/api/intelligence/knowledge-digest` (Mondays). Injected into Ada's system prompt as CURRENT SEO INTELLIGENCE block. UNIQUE(agent_type, week_of). |

---

## Knowledge Panel (client_knowledge)

The persistent brain per client. Injected into every agent session — eliminates redundant tool calls.

**Written by:**

| Trigger | Fields written |
|---|---|
| `/api/crawl` completes | site_pages, site_pages_updated_at, site_summary, content_summary (Haiku call using content_history + keyword_banks) |
| `/api/gsc/sync` completes | gsc_snapshot (near_miss pos 3-20 >15imp, low_ctr pos<=10 ctr<3% >30imp, top_queries by clicks, totals), gsc_snapshot_updated_at |
| `update_agent_notes` tool | agent_notes[agent.slug] |
| `/api/keywords/backfill-targeting` | Updates keyword_banks.content_targeting_this (not a knowledge panel field, but called from refresh) |
| Agent session start (background, fire and forget) | Triggers crawl if site_pages >7 days old. Triggers GSC sync if snapshot >48 hours old. |
| Refresh button (client page) | Crawl + GSC sync + backfill-targeting in parallel |

**Injected into buildSystemPrompt as:**
- Full page inventory: url, title, word_count, H1 — with crawl date
- GSC snapshot: totals (clicks, impressions, avg_position, ctr), near-miss keywords, low-CTR pages, top 30 queries
- Content summary prose
- Agent notes for the current agent's slug
- Competitor analysis: if `agent_notes.competitor_analysis` exists and is under 7 days old, injected as a `COMPETITOR ANALYSIS (from Xh ago):` block — Ada has the gap analysis without calling the tool again
- Knowledge docs: `docs` jsonb array, each `{ id, title, content, updated_at }`. Injected as `KNOWLEDGE DOCUMENTS — read and apply these on every response:` block. Editable via client Knowledge tab.
- Current SEO intelligence: latest `agent_knowledge` row injected as `CURRENT SEO INTELLIGENCE (week of ...)` block if present

---

## Token Routing

| Turn type | Model | Max tokens |
|---|---|---|
| Writing (blog post, article, plan) | claude-sonnet-4-6 | 16,000 |
| Standard analytical/conversational | claude-sonnet-4-6 | 4,000 |
| Fetch/lookup/tool-only turns | claude-haiku-4-5-20251001 | 2,000 |
| Acknowledgement turn | claude-haiku-4-5-20251001 | 150 |
| Calendar plan generation | claude-sonnet-4-6 | 4,000 |
| Client overview | claude-haiku-4-5-20251001 | 512 |
| Content summary (on crawl) | claude-haiku-4-5-20251001 | 300 |
| Keyword backfill matching | claude-haiku-4-5-20251001 | 1,500 |
| Report executive summary | claude-sonnet-4-6 | 300 |
| Silent summary (empty end_turn) | claude-sonnet-4-6 | 512 |

---

## Cron Pipeline (daily 07:00 UTC)

```
GET /api/schedule/check
├── For each due client_schedule:
│   └── POST /api/schedule/run
│       └── Pick untargeted keyword (highest priority, content_targeting_this IS NULL)
│           → insert content_queue → update next_run_at
│
├── For each GSC connection not synced in 23h:
│   └── POST /api/gsc/sync
│       ├── Fetch 7d/28d/90d from GSC API
│       ├── Delete + reinsert search_performance rows
│       ├── Update keyword_banks.current_position
│       ├── Create briefing_items (near-miss, low-CTR)
│       ├── Write client_knowledge.gsc_snapshot
│       ├── Update file_tree (sitemap) on client_profiles
│       └── discoverKeywordsFromGSC → keyword_suggestions
│
├── On 1st of month:
│   └── POST /api/reports/generate per client with content last month
│
├── On Mondays (day === 1):
│   └── POST /api/intelligence/knowledge-digest
│       └── Web search current SEO developments → summarise with Sonnet → agent_knowledge
│
├── For each due scheduled_job:
│   └── POST /api/jobs/run
│       ├── gsc_intelligence: sync + decay detection + score-keywords + overview refresh
│       ├── keyword_research: discoverKeywordsFromGSC from stored search_performance
│       ├── content: run client_schedule → content_queue (respects content_autonomy)
│       └── site_audit: crawl → site_pages + client_knowledge
│
├── For each due agent_automation:
│   └── POST /api/intelligence/run-automation
│       └── Updates last_run_at, last_run_status, last_run_summary on completion
│
└── POST /api/notifications/digest
    └── Per workspace: count drafts + pending keywords + next schedule → email + Slack
```

---

## Content Lifecycle

```
1. DISCOVERY
   GSC sync / analyse_gsc tool → keyword_suggestions (pending)
   User approves at /keywords → keyword_banks

2. PLANNING
   Ada chat or /api/calendar/generate-plan → content_calendar (planned)
   OR client_schedule fires → content_queue (queued, via cron)

3. WRITING — two paths:
   Path A (interactive): User asks Ada in chat → Ada writes → write_content tool
     → content_outputs (draft, approved=false)
     → keyword_banks.content_targeting_this = /outputs/{id}
     → output-ready notification

   Path B (autonomous): /api/run-task picks queued item → full-context Sonnet call (no tools)
     → content_outputs (draft)
     → token usage logged server-side and queue status updated

4. REVIEW
   User reviews at /outputs/{id}
   Optional: feedback chips → Ada revises via chat (send feedback to Ada button)
   Optional: version history
   User approves → content_outputs.approved = true
   → content_history insert
   → keyword_banks.content_targeting_this updated

5. PUBLISH (Theo)
   publish_content tool → /api/connections/publish
   → GitHub: images committed to /public/assets/, MDX committed with frontmatter
   → Vercel deploy triggered
   → content_outputs.published_url set
   → keyword_banks.content_targeting_this = live URL

6. MONITORING
   GSC sync daily → search_performance updated
   intelligence/decay → briefing_items if ranking drops
   intelligence/score-keywords → opportunity_score recalculated
   knowledge panel gsc_snapshot refreshed
```

---

## Autonomy Levels (client_profiles.content_autonomy)

| Level | Behaviour |
|---|---|
| `manual` | Queue item created, human writes interactively |
| `auto_approve` | Content written autonomously (run-task) and auto-approved, human publishes |
| `full_autopilot` | Written, approved, and submitted for Vercel promotion automatically |

---

## Active Clients

| Client | ID | Platform | Status |
|---|---|---|---|
| Hear Better | d46432ec-520c-4b16-8752-9b3f3b908f79 | Next.js + GitHub + Vercel | Active. Knowledge panel populated. 26 pages. 3 posts live. 17/19 keywords targeted. |

---

## Known Bugs

| Bug | Severity | File | Status |
|---|---|---|---|
| Task log panel renders raw JSON/code during Working... state | Medium | agents/[id]/page.tsx render | **Fixed 11 Jun 2026** — thoughts render block removed |
| Em-dashes still appearing in agent responses | Medium | buildSystemPrompt | Open — rule exists but not enforced hard enough |
| `run-task` route uses simplified prompt with no knowledge panel or tools | High | api/run-task/route.ts | **Fixed 11 Jun 2026** — full system prompt + parallel context loading |
| `getToolsForAgent` still uses old filter logic (not all-tools-for-all-agents) | Medium | agents/[id]/page.tsx | Open — overhaul prompt may not have applied this |
| `buildSystemPrompt` still has old hardcoded image rules | Medium | agents/[id]/page.tsx | Open — overhaul prompt may not have applied new version |
| microsuction-near-me-north-east.mdx missing image frontmatter | Low | GitHub repo | Open — repair route needs running |
| Suggested replies `<suggestions>` tags not always stripped cleanly | Low | agents/[id]/page.tsx | Open |
| Token usage not recording (tokens_used always 0 in agent_activity) | High | agents/[id]/page.tsx | **Fixed 11 Jun 2026** — totalTokensUsed accumulator + increment_token_usage RPC after loop |
| keyword approve funnel_stage check constraint violation | High | api/keywords/approve/route.ts | **Fixed 11 Jun 2026** — changed 'top'/'middle'/'bottom' to 'tofu'/'mofu'/'bofu' |
| Client insert 403 (RLS violation) | High | clients/page.tsx | **Fixed 11 Jun 2026** — workspace_id and user_id now loaded and passed on insert |
| Competitor pages had no content_summary | High | api/crawl/route.ts | **Fixed 11 Jun 2026** — Haiku summarisation pass added after competitor crawl |
| Slug only picks up first letter | Medium | clients/page.tsx | **Fixed 11 Jun 2026** — single setForm call using functional updater |
| Client profile top panel not editable | Medium | clients/[id]/page.tsx | **Fixed 11 Jun 2026** — profileFields rendered as textareas with onBlur save |
| Collapsible sections (Brand, Business, SEO) closed by default | Low | clients/[id]/page.tsx | **Fixed 11 Jun 2026** — all three sections open by default |
| GSC redirect_uri_mismatch | High | Google Cloud Console config | Open — needs redirect URI added: https://agencee.vercel.app/api/auth/google/callback (manual config fix) |
| Briefing items missing workspace_id | High | api/intelligence/run-automation + ada-briefing | **Fixed 11 Jun 2026** — workspace_id added to client_profiles select; all briefing_items upserts now include workspace_id |
| Overview page content count global (not per-agent) | Medium | agents/[id]/overview/page.tsx | **Fixed 11 Jun 2026** — counts via agent_activity.action='content_created' for this agent_id instead of content_outputs with agent_type filter |
| Overview page totalTokens only counted last 20 activity rows | High | agents/[id]/overview/page.tsx | **Fixed 11 Jun 2026** — separate full query for all-time tokens; limit(20) slice used only for activity feed display |
| Overview keyword count showing 0 instead of n/a | Low | agents/[id]/overview/page.tsx | **Fixed 11 Jun 2026** — shows 'n/a' when count is 0 |
| Agent notes slug mismatch (notes written to 'agent', read from 'ada') | High | agents/[id]/page.tsx | **Fixed 11 Jun 2026** — slug fallback: agent.slug \|\| agent.name.toLowerCase() \|\| 'ada' in both update_agent_notes handler and buildSystemPrompt |
| Agent notes injected as raw JSON object | Medium | agents/[id]/page.tsx buildSystemPrompt | **Fixed 11 Jun 2026** — structured object formatted into readable lines (last session, recommendations, pending, history) |
| Auto debrief threshold too broad (triggered on 'improve' keyword) | Medium | agents/[id]/page.tsx | **Fixed 11 Jun 2026** — debrief only fires when task log contains 'Saving draft', 'Loading keyword bank', 'Analysing GSC', or 'Checking content history' labels |
| Schedule/check cron GSC sync filtering on 'active' only | High | api/schedule/check/route.ts | **Fixed 11 Jun 2026** — changed .eq('status','active') to .in('status',['active','connected']) |
| GSC sync 400 — token refresh failing silently | High | src/lib/gsc.ts | **Fixed 11 Jun 2026** — getValidAccessToken now calls Google token endpoint directly (no proxy through /api/auth/google/refresh). Surfaces real error: missing env vars, expired token, revoked access. Manual reconnect required for existing expired tokens. |
| Task log dead msgThoughts variable | Low | agents/[id]/page.tsx | **Fixed 11 Jun 2026** — dead `msgThoughts` variable removed from message render loop. Thoughts never rendered; agentStatus confirmed hardcoded strings only. |
| Blog not completing (loop exit too aggressive) | Critical | agents/[id]/page.tsx | **Fixed 11 Jun 2026** — loop exit condition raised from loopCount >= 3 to loopCount >= 6. Ada now has up to 6 post-draft turns before the Haiku wrap-up. Duplicate prevention still active via draftSavedRef dedup check. |
| Duplicate write_content — 9 drafts from one conversation (~120k tokens wasted) | Critical | agents/[id]/page.tsx | **Fixed 11 Jun 2026** — 30min dedup check in write_content handler returns already_existed=true; loop exits via Haiku wrap turn after draftSavedRef set + loopCount>=3 |
| Session token counter reset on every message | High | agents/[id]/page.tsx | **Fixed 11 Jun 2026** — removed reset from send(); only resets in newConversation() |
| All 6 automations broken (wrong column names, wrong tables, no output) | Critical | api/intelligence/run-automation/route.ts | **Fixed 11 Jun 2026** — weekly_keyword_scan uses monthly_volume+opportunity_score; internal_link_audit uses internal_links jsonb array; competitor_analysis uses competitor_sites table; site_audit analyses crawled pages; monthly_content_plan calls generate-plan route; all create briefing_items |
| Sidebar today spend not updating (agent_activity not inserted when workspaceId null) | High | api/chat/route.ts | **Fixed 11 Jun 2026** — workspaceId guard removed; always inserts with workspace_id: workspaceId \|\| null |
| GitHub 500 on save | High | api/clients/[id]/github/route.ts | **Fixed 11 Jun 2026** — encrypt() failure now returns a clear 500 error message explaining ENCRYPTION_KEY must be a 32-byte base64 string. ENCRYPTION_KEY env var required in Vercel. |
| GSC connections tab empty after OAuth redirect | High | clients/[id]/page.tsx | **Fixed 11 Jun 2026** — client page now reads `?tab=` and `?gsc=` URL params on mount. Tab param switches to the correct tab. gsc=connected shows a 4s success message. gsc=error with message=no_properties shows appropriate error. |
| Service-role API routes callable without user/internal auth | Critical | api/* routes | **Fixed 11 Jun 2026 audit** - shared Supabase bearer auth, CRON_SECRET internal auth, ownership checks, and rate/budget guards added across high-risk routes. |
| `/api/schedule/check` skipped most cron work when no client_schedules were due | Critical | api/schedule/check/route.ts | **Fixed 11 Jun 2026 audit** - removed early return and now awaits authenticated GSC, job, automation, report, digest, and notification subrequests. |
| Browser-side and server-side token tracking could double count usage | High | agents/[id]/page.tsx + api/chat/route.ts | **Fixed 11 Jun 2026 audit** - removed browser RPC increment and centralised usage recording in server AI routes. |
| `content_queue` runtime columns absent in live DB | High | Supabase migration | **Migration added 11 Jun 2026 audit** - `20260611_queue_runtime_columns.sql` adds started/completed/error/calendar/notes/update columns and helpful indexes. Apply manually if MCP/CLI migration access is unavailable. |
| Theo sidebar nav uses `upload` icon not mapped in Sidebar ICONS | Low | components/Sidebar.tsx | **Fixed 11 Jun 2026 audit** - added `upload` icon mapping. |
| Google OAuth `state` is plain client_id | Medium | api/auth/google* | Open - replace with signed expiring state or server-side OAuth session. Current callback validates property/client flow but not signed state. |
| Full live schema/RLS/index dump blocked in local environment | Medium | Supabase access | Manual - provide `SUPABASE_ACCESS_TOKEN` or DB password/psql, or run SQL in Supabase dashboard. |

---

## Next to Build (Priority Order)

### Immediate fixes
1. ~~Verify agent overhaul prompt was fully applied~~ — done (getToolsForAgent + buildSystemPrompt both updated, web search added)
2. ~~Fix task log UI bug~~ — done
3. ~~Fix token tracking~~ — done
4. ~~Upgrade run-task~~ — done
5. ~~Web search tool~~ — done (native web_search_20250305, SEO agents only)
6. ~~Knowledge docs UI~~ — done (client Knowledge tab, docs injected into system prompt)
7. ~~Weekly SEO digest~~ — done (knowledge-digest route, Monday cron, agent_knowledge table)

### Advanced intelligence (next session)
5. Extended thinking mode for complex strategy sessions (one parameter change in send())
6. Auto debrief — agents auto-call update_agent_notes at end of every conversation
7. Content decay surface in Ada — she should be aware of declining pages from knowledge panel
8. Proactive GSC briefing — cron triggers Ada to analyse and write briefing_items autonomously
9. Performance feedback loop — link GSC data back to content_outputs so Ada knows post performance
10. Topic cluster mapping tool — pillar/supporting content architecture
11. Internal link equity audit — pages with no inbound or outbound internal links

### Scale and reseller
12. Weekly personalised briefing email per client (not generic digest)
13. Client onboarding automation — new client triggers full audit + knowledge panel + opportunity report
14. White-label system — zero Agencee references in any agent output
15. Cross-client intelligence — pattern analysis across multiple clients

### New tools (larger lift)
16. SERP analysis tool — live SERP data per keyword (DataForSEO or SerpAPI)
17. E-E-A-T audit — credential/entity optimisation for regulated niches
18. Competitor monitoring on schedule — crawl weekly, surface new pages as briefing items
19. Second client (WordPress) — stress-test multi-tenancy

---

## Environment Variables

| Variable | Purpose |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon key |
| SUPABASE_SERVICE_KEY | Supabase service role key |
| SUPABASE_ACCESS_TOKEN | Optional for Supabase MCP/CLI management tasks. Required for automated schema/RLS/index dump and remote migrations from Codex. |
| ANTHROPIC_API_KEY | Anthropic API key |
| GEMINI_API_KEY | Gemini / Nano Banana key |
| CRON_SECRET | Vercel cron auth secret |
| NEXT_PUBLIC_SITE_URL | Production URL (used in cron sub-requests and notifications) |
| GOOGLE_CLIENT_ID | Google OAuth client ID |
| GOOGLE_CLIENT_SECRET | Google OAuth client secret |
| GOOGLE_REDIRECT_URI | Must match Google Cloud Console exactly |
| RESEND_API_KEY | Resend email API key |
| GITHUB_TOKEN | GitHub token for Hear Better repo |
| VERCEL_TOKEN | Vercel API token (deploy triggers) |

---

## Key IDs

| Item | Value |
|---|---|
| Supabase project | qzyksnszutnorppfqchz |
| Hear Better client_id | d46432ec-520c-4b16-8752-9b3f3b908f79 |
| Ada agent_id | 1300a385-17d3-41e1-9535-50f5b9c49823 |
| GSC connection | b6be250d-0eec-4429-a601-77d8495dbd57 |
| Hear Better Vercel project | ear-better-next-public (prj_bXp45NsRLpRolrmkvOf1arAbTrtr) |
| Hear Better GitHub repo | cnvrtagency/wireframe-whisperer-89 (branch: main) |
| VERCEL_TOKEN | stored in Vercel env vars — do not commit |
| User email | danlyons@gmail.com |

---

## Session Change Log

### 11 June 2026
**Built:**
- Knowledge panel (`client_knowledge` table) — site_pages, gsc_snapshot, content_summary, docs, agent_notes
- `/api/knowledge/[clientId]` GET/PATCH route
- GSC sync writes gsc_snapshot to knowledge panel (near_miss, low_ctr, top_queries, totals)
- Crawl writes site_pages + content_summary (Haiku) to knowledge panel
- `update_agent_notes` tool added to ALL_TOOLS
- Backfill auto-trigger on agent session start (background, fire and forget)
- "Refresh knowledge panel" button on client page
- `/api/keywords/backfill-targeting` — Haiku semantic matching of keywords to live site pages
- `/api/calendar/generate-plan` — full context, one Sonnet call, JSON plan, inserts to content_calendar
- Calendar page rebuilt — month grid view, drawer, Write now, list toggle, staged generation progress
- Keyword approve float→integer fix (`Math.round` on position)
- keyword_banks.content_targeting_this now updated on: write_content, approve (outputs page), approve (dashboard), publish (publish route)
- SQL backfill run for Hear Better (1 match)
- Haiku backfill-targeting run for Hear Better (17/19 keywords matched)
- AgenceeLogo component (PNG-based, animated, splash/sidebar variants)
- Design overhaul prompt written (colours, responsive sidebar, brand tokens)
- Agent system overhaul prompt written (universal working principles, knowledge panel injection, SCHEMA images, suggested replies, model routing)

**Known still open:**
- Em-dashes in responses
- Verify agent overhaul prompt applied in production (getToolsForAgent, buildSystemPrompt)

### 11 June 2026 (session 12 - stabilisation audit)
**Fixed:**
- Added shared API auth helpers, browser authenticated fetch wrapper, internal CRON_SECRET auth, ownership checks, route rate limiting, and server-side token usage recording.
- Hardened high-risk service-role routes including chat, run-task, crawl, image generation, calendar generation, reports, client overview, GitHub/connections, briefing/activity, outputs, jobs, automations, GSC, keyword actions, notifications, Vercel promotion, and workspace API key storage.
- Fixed `/api/schedule/check` early return so the full cron pipeline still runs when no client schedules are due.
- Scoped run-task, jobs, automations, notifications, and sidebar usage to the owning workspace/client where possible.
- Added shared pricing constants and replaced old blended `$4/M` estimates in visible dashboards/activity pages.
- Closed remaining AI route budget gaps for crawl, image generation, and user-triggered knowledge digest; crawl Haiku summary calls now record actual token usage.
- Built `/usage` with workspace usage totals, budget progress, action breakdown, route protection status, and recent activity.
- Added `20260611_queue_runtime_columns.sql` for queue runtime columns and indexes discovered missing from live Supabase.

**Verification:**
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- Local `/usage` smoke passes: `GET /usage 200` in Next dev and no browser console errors.
- `npm audit --audit-level=moderate` reports only Next bundled PostCSS moderate advisories; npm's proposed fix downgrades Next and was not applied.
- `npm run lint` still fails on broad pre-existing strict lint debt, especially `no-explicit-any` and unused variables across older routes/components.

**Still open/manual:**
- Supabase MCP/schema/RLS/index dump requires `SUPABASE_ACCESS_TOKEN` or a DB password/psql/Docker path.
- Google OAuth state should be signed.
- Queue runtime migration was applied manually and verified live from the app service client.

### 11 June 2026 (session 2)
**Fixed:**
- Task log thoughts render block removed (raw AI reasoning no longer shown to user in task log panel)
- Token tracking: totalTokensUsed accumulator wired into send() loop + increment_token_usage RPC called after loop
- run-task upgraded: parallel context load (knowledge panel, content history, site pages, keyword bank) + full system prompt with client context + max_tokens raised to 12000

### 11 June 2026 (session 3)
**Fixed:**
- keyword approve funnel_stage constraint violation — 'top'/'middle'/'bottom' changed to 'tofu'/'mofu'/'bofu' in approve route
- Client insert 403 — workspace_id and user_id now loaded on mount and passed on insert
- Add client modal simplified to 4 fields (name, website, industry, slug); saves immediately and redirects to client detail page to complete profile

### 11 June 2026 (session 5)
**Built (cost optimisations):**
- Sitemap-first crawl — `fetchSitemapUrls()` tries /sitemap.xml, /sitemap_index.xml (recursing into sub-sitemaps, max 5), /sitemap/, /sitemap before falling back to link crawling. Applied to both client site crawl (maxPages 60) and competitor crawl (maxPages 40). When sitemap mode is active, link extraction inside the while loop is skipped (`usingSitemap` flag). Uses Chrome browser UA for sitemap fetches.
- Conversation summarisation — `summariseOldMessages()` added before `send()`. When conversation > 8 messages, all but the last 6 are condensed via a Haiku call (600 tokens) into a 2-message summary block. Falls back silently to full history on error. Cuts input tokens 60-80% on sessions > 8 turns.
- Stored competitor analysis — `analyse_competitors` now upserts `client_knowledge.agent_notes.competitor_analysis` with result (capped 4000 chars) and timestamp. `buildSystemPrompt` injects this into the knowledge panel if under 7 days old, labelled with age in hours. Ada doesn't need to re-call the tool on subsequent asks in the same window.

### 11 June 2026 (session 6)
**Built:**
- Web search tool — native Anthropic `web_search_20250305` tool added to SEO agent's tool array. `getToolsForAgent` updated to inject it for non-technical agents. `web_search` filtered from `toolBlocks` so it doesn't call `handleToolCall` — Anthropic handles it server-side. `TOOL_STATUS` label added ("Searching the web..."). `web-search-2025-03-05` beta header dynamically added in `/api/chat` when tools include the web search type. System prompt updated with guidance on when to use web_search.
- Knowledge docs UI — new Knowledge tab on `/clients/[id]` page. Documents stored as `client_knowledge.docs` jsonb array (`{ id, title, content, updated_at }`). Inline editing, add/delete. `addDoc`, `saveDoc`, `deleteDoc` functions. Knowledge docs injected into Ada's system prompt as `KNOWLEDGE DOCUMENTS` block (prominent, per-client). `buildSystemPrompt` updated to use a cleaner `### Title\nContent` format.
- Weekly SEO knowledge digest — new `agent_knowledge` DB table. New `/api/intelligence/knowledge-digest` route: uses web_search to find current SEO developments, summarises with Sonnet, stores weekly by `agent_type`. Deduplicates — skips if this week's row already exists. Cron runs it on Mondays. `loadDigest()` function on agent page loads latest row. Injected into system prompt as `CURRENT SEO INTELLIGENCE (week of ...)` block.
- GitHub 500 fix — `encrypt()` call wrapped in try/catch in github route. Clear 500 error returned with ENCRYPTION_KEY instructions. `saveGithub()` on client page now checks the response and surfaces the error in `syncError` state.
- GSC OAuth redirect fix — client detail page now reads `?tab=` and `?gsc=` URL params on mount via `useSearchParams`. Redirects from OAuth callback or gsc-setup page now land on the Connections tab with a 4s success message. `gsc=error&message=no_properties` shows the correct error.

**DB migration required (run in Supabase dashboard SQL editor):**
```sql
CREATE TABLE IF NOT EXISTS agent_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type text NOT NULL DEFAULT 'seo',
  week_of date NOT NULL,
  summary text NOT NULL,
  sources text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  UNIQUE(agent_type, week_of)
);
```

### 11 June 2026 (session 7)
**Built:**
- Agent overview page — `/agents/[id]/overview` with stats row (conversations, drafts, keywords, tokens, cost est.), client knowledge status panel, current SEO digest, automations status, recent activity feed. "Chat with" CTA. Cost figures marked (est.).
- Automations sidebar page — moved from tab on main agent page to `/agents/[id]/automations`. Removed automations tab from `agents/[id]/page.tsx`. Added `automations` icon (repeat arrows SVG) to `Sidebar.tsx` ICONS map.
- Session cost tracking — `sessionTokens` + `sessionCost` state + `sessionTokensRef` ref in agent page. Accumulates per turn: input tokens × $3/M + output tokens × $15/M (Sonnet pricing). Displayed in chat header (tokens + $ (est.)), coloured amber above $0.10. Resets on new conversation and at start of send().
- Today's cost in sidebar — `todaySpend` state loads on mount + refreshes every 30s via `setInterval`. Queries `agent_activity` for today's tokens × $4/M blended. Shown in sidebar bottom panel above token budget bar. Marked (est.). Amber above $1.
- Crawl 403 fix — workspace_id lookup now uses fallback chain: google_connections → client_profiles → first workspace. Applied to both normal crawl and competitor crawl sections. Competitor pages now include workspace_id.
- GSC sync 400 — confirmed already fixed in previous session (gsc_review case correctly passes connection_id).

**Token tracking note:** Session cost uses per-call Sonnet pricing ($3 input / $15 output per million tokens). Sidebar and overview use blended $4/M. All figures are estimates — cache discounts not applied.

**SQL still required (run in Supabase dashboard):**
- `agent_automations` table (from session 6)
- `agent_knowledge` table (from session 6)
- Update Ada's nav_items to add Overview as first item (see session notes)

### 11 June 2026 (session 8)
**Fixed:**
- Duplicate write_content — 9 drafts per conversation, estimated ~120k tokens wasted per session. Fixed with 30-minute dedup check (same keyword + client, approved=false) before insert. Returns `already_existed: true` with a "do not call again" message. `draftSavedRef` tracks state across the loop. After `write_content` succeeds and `loopCount >= 3`, loop exits via a Haiku wrap-up turn (max 500 tokens) rather than continuing — prevents Ada from re-entering the loop.
- Session token counter resetting per message — `setSessionTokens(0)/setSessionCost(0)/sessionTokensRef.current=0` was at the top of `send()`. Removed. Counter now accumulates across the full conversation and only resets in `newConversation()`.
- All 6 automations broken — corrected every handler in `run-automation/route.ts`: wrong column (`search_volume` → `monthly_volume`, `internal_links_count` → `internal_links` jsonb array), wrong table (`client_profiles.competitors` → `competitor_sites`), missing briefing_item creation, `monthly_content_plan` now calls `/api/calendar/generate-plan` instead of bare `/api/chat`, `gsc_review` now reports briefing items created per connection.
- Sidebar today spend not updating — `agent_activity` insert was guarded by `if (workspaceId)`. Guard removed; always inserts with `workspace_id: workspaceId || null`. Today's spend now accumulates correctly regardless of workspace resolution timing.
- Schedule editing UI — inline editor on automations page. "Schedule" button per row opens/closes a panel below the card (card border-radius adjusts). Panel has cadence pill row (daily/weekly/monthly), day-of-week pill row (weekly only), hour dropdown (UTC), "Save schedule" button. Saves to `agent_automations` and recomputes `next_run_at`.

**Token waste note:** The duplicate write_content bug was responsible for most unexpectedly high session costs. Each duplicate invocation costs ~10-25k tokens for the write + image generation. With 9 drafts per session this was estimated at ~120k tokens (~$0.50+) per affected conversation.

### 11 June 2026 (session 11)
**Fixed:**
- GSC token refresh 400 — `getValidAccessToken` in `src/lib/gsc.ts` now calls Google's token endpoint directly with `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (previously proxied through `/api/auth/google/refresh`). Returns specific error: missing env vars, invalid_grant (expired/revoked), HTTP status. Manual reconnect required for Hear Better if tokens are permanently expired. `safeDecrypt` applied to both access_token (cached path) and refresh_token (refresh path) to handle encrypted storage.
- Task log cleaned — removed dead `msgThoughts` variable from message render loop. Thoughts never rendered anywhere. All `setAgentStatus` calls confirmed as hardcoded human-readable strings.
- Progress bar — indeterminate `progress-indeterminate` CSS animation added to globals.css. Blue bar slides across the top of the input container while Ada is active. Left task log panel shows prominent pulsing label for the current active tool (last item in taskLog array).
- Knowledge tab now shows Ada's notes — `client_knowledge.agent_notes` and `content_summary` loaded on mount. Knowledge tab renders: content summary card, Ada's notes panel (last_conversation summary + recommendations + pending + history count), then manual docs. `competitor_analysis` key excluded from notes display (shown via separate analysis tool).
- Blog loop exit raised — `draftSavedRef.current && loopCount >= 3` → `loopCount >= 6`. Gives Ada 3 extra tool-call turns after saving the draft (for generate_images + suggest_internal_links) before the Haiku wrap fires. Verified `draftSavedRef.current = true` only in two correct places.

**Note on GSC reconnect:** The existing Hear Better GSC connection likely has permanently expired tokens. After deploy: client Connections tab → disconnect → reconnect via OAuth.

### 11 June 2026 (session 10 — platform stability sweep)
**Fixed:**
- Briefing items missing workspace_id — added `workspace_id` to `client_profiles` select in `run-automation/route.ts`; all three `briefing_items` upserts (weekly_keyword_scan, internal_link_audit, site_audit) now include `workspace_id: client.workspace_id || null`
- New `/api/intelligence/ada-briefing` route — POST endpoint for Ada to create proactive briefing items. Loads workspace_id from client_profiles, upserts with workspace_id, logs agent_activity
- Overview content count was global (all SEO outputs) — now queries `agent_activity.action='content_created'` filtered by agent_id for accurate per-agent count
- Overview totalTokens used only last 20 activity rows — added full `agent_activity.tokens_used` query (no limit) for the stat; limit(20) slice remains for the feed display
- Overview keyword count showing 0 — now shows 'n/a' when count is 0 (suggested_by may not be populated for older rows)
- Agent notes slug mismatch — `update_agent_notes` handler and `buildSystemPrompt` both now use `agent.slug || agent.name.toLowerCase() || 'ada'` fallback so notes written by the tool are always read back correctly
- Agent notes injected as raw JSON — `buildSystemPrompt` now formats the structured `{ last_conversation, history }` object into readable lines (last session summary, recommendations, pending items, prior session summaries). Handles both old string format and new object format gracefully
- Auto debrief threshold too broad — debrief now only fires when task log contains a significant label ('Saving draft', 'Loading keyword bank', 'Analysing GSC', 'Checking content history'). Fires for SEO agents only. Writes structured `{ last_conversation, history }` to `client_knowledge.agent_notes[slug]` via Haiku call post-loop (fire-and-forget, non-blocking)
- Schedule/check cron GSC status filter — changed `.eq('status','active')` to `.in('status',['active','connected'])` so cron syncs connections saved by OAuth callback

### 11 June 2026 (session 9)
**Fixed:**
- Messages disappearing on navigation — `loadMessages()` now calls `localStorage.setItem('agencee_last_conv_${agentId}', convId)`. On mount, URL param falls back to `localStorage.getItem(...)` if no `?conversation=` param. `newConversation()` removes the key. Conversations now survive page refresh and navigation without requiring a URL parameter.
- Ada generating images on revision requests — `write_content` tool schema now includes `is_revision: boolean`. Handler short-circuits with a "do NOT call generate_images" response before Ada can proceed to image generation. `buildSystemPrompt` IMAGE GENERATION section reinforced with 3 explicit rules: revisions set `is_revision: true`, if `is_revision` is true skip `generate_images`, proceed directly to `suggest_internal_links` instead.
- GSC sync 400 "Connection not found" — `google_connections.status` is saved as `'connected'` by the OAuth callback, but both `gsc/sync/route.ts` and `run-automation/route.ts` were filtering for `'active'` only. Changed `.eq('status', 'active')` to `.in('status', ['active', 'connected'])` in both files. **Note:** `google_connections.status` can be either `'active'` or `'connected'` — both are valid.
- Crawl silent 400 — Added explicit early validation at the top of `api/crawl/route.ts` before the competitor branch: returns 400 if `client_id` is missing (non-competitor path), 400 if `website` is missing for a client crawl. Previous validation at line ~275 came too late (after competitor branch).
- Image generation 500 (Gemini API) — GEMINI_API_KEY missing now returns 200 with `skipped: true` instead of 500. All internal error paths return 200 with `skipped: true` so Ada doesn't retry in a burning loop. Added model fallback array: `['gemini-3-pro-image', 'gemini-2.0-flash-preview-image-generation', 'imagen-3.0-generate-002']` — tries each in order, logs failures as warnings, only errors out (gracefully) if all three fail.

**Reminder — Vercel env vars to check:**
- `GEMINI_API_KEY` — required for image generation
- `ENCRYPTION_KEY` — required for GitHub integration (32-byte base64)
- `GOOGLE_REDIRECT_URI` — must match Google Cloud Console exactly
- `NEXT_PUBLIC_SITE_URL` — used in cron sub-requests

### 11 June 2026 (session 4)
**Built:**
- Competitor page Haiku summaries — crawl route now runs summarisation pass (up to 20 pages) after competitor crawl, writes content_summary to competitor_pages
- analyse_competitors tool upgraded — now returns per-site summaries + gap analysis comparing competitor topics to client site pages
- Calendar generate-plan upgraded — loads competitor pages with summaries; new TASK prompt with near-miss wins, featured snippet gaps, competitor gaps, cannibalisation detection, topical authority gaps; returns intelligence_notes; max_tokens raised to 6000
- Calendar page — intelligence_notes displayed as amber callout below Ada's summary
- Competitor tab — "X pages analysed" badge shows when content_summary rows exist
- Slug generation fixed — single functional setForm call (was firing on first char only)
- Client profile top panel now editable textareas with Saved confirmation on blur
- All three collapsible sections (Brand, Business, SEO) open by default
- GSC redirect_uri_mismatch documented as open (needs Google Cloud Console config — manual fix)
