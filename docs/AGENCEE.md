# Agencee — Technical Documentation

Internal agency operations dashboard. Multi-tenant SaaS for agency owners to manage AI agents, brief content tasks, review drafts, track keyword performance, and monitor client SEO health.

---

## Overview

1. Dan briefs Ada (SEO agent) in chat
2. Ada plans content, suggests keywords, builds calendars, queues tasks via tool use
3. Content is queued and run against the Claude API; drafts saved automatically
4. Dan reviews, approves, and publishes outputs from the dashboard
5. Autonomous schedules run per-client; Ada proactively surfaces opportunities from GSC data
6. Monthly reports auto-generated on the 1st of each month

---

## Tech Stack

**Frontend / UI**
- Next.js 14 (App Router), TypeScript
- CSS custom properties only — all inline CSS objects, no Tailwind utilities
- Google Fonts: Instrument Serif (display/wordmark), Inter (body), JetBrains Mono (data)
- CSS vars: `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--border-bright`, `--text`, `--text-2`, `--text-dim`, `--accent`, `--accent-hover`, `--accent-glow`, `--accent-bg`, `--green`, `--green-bg`, `--amber`, `--amber-bg`, `--red`, `--red-bg`, `--purple`, `--purple-bg`, `--font-sans`, `--font-mono`, `--font-display`, `--radius`, `--radius-md`, `--radius-lg`

**Backend / Data**
- Supabase (PostgreSQL) — RLS enabled on all tables
- Project URL: `https://qzyksnszutnorppfqchz.supabase.co`
- Anon key used client-side; service role key used in API routes (`SUPABASE_SERVICE_KEY`)

**AI**
- Anthropic API
- `claude-opus-4-8` for scheduled tasks (worker)
- `claude-sonnet-4-6` for chat (UI) and report executive summaries
- Prompt caching enabled (`anthropic-beta: prompt-caching-2024-07-31`)

**Hosting**
- UI: Vercel (or locally on `http://localhost:3000`)
- Cron: Vercel Cron (`vercel.json`) — daily at 07:00 UTC calls `/api/schedule/check`

---

## Environment Variables

`.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://qzyksnszutnorppfqchz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=         # Service role key — used in ALL API routes (not SUPABASE_SERVICE_ROLE_KEY)
ANTHROPIC_API_KEY=
NEXT_PUBLIC_SITE_URL=https://your-app.vercel.app
CRON_SECRET=                  # Required — /api/schedule/check rejects all calls if not set (fail-closed)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your-app.vercel.app/api/auth/google/callback
ENCRYPTION_KEY=               # 32 bytes, base64-encoded — used for token encryption
RESEND_API_KEY=               # Resend.com transactional email
VERCEL_TOKEN=                 # Vercel API token (from vercel.com/account/tokens)
VERCEL_PROJECT_ID=            # Vercel project ID (from project settings)
VERCEL_TEAM_ID=               # Vercel team ID (optional — only needed for team projects)
GEMINI_API_KEY=               # Gemini API key for image generation
```

**Critical:** The service key env var is `SUPABASE_SERVICE_KEY` — not `SUPABASE_SERVICE_ROLE_KEY`. Using the wrong name causes connection routes to crash silently.

---

## Content Pipeline

Ada writes markdown content; the output is stored in `content_outputs` immediately. Publishing commits the finished post and its images to the client's GitHub repo in one atomic operation.

```
Ada generates images → Supabase Storage
Ada writes markdown → content_outputs (draft, status: pending review)
You approve in Agencee → click Publish → images downloaded + MDX file committed atomically
```

**Flow in detail:**
1. Ada calls `generate_images` → images uploaded to Supabase Storage `blog-images` bucket; public URLs returned
2. Ada writes the post in markdown with YAML frontmatter, embedding the Supabase image URLs
3. Ada calls `write_content` → inserts `content_outputs` row (`format: 'markdown'`, `images: []`, notes)
4. Notification fires: "Content ready for review"
5. You review at `/outputs/[id]` — pipeline shows Draft → Approved → Published steps
6. Approve → click Publish (select connection) → `POST /api/connections/publish`
7. Publish route downloads each image from Supabase, rewrites URLs to `/assets/filename`, commits MDX + images atomically via `atomicCommit` in `src/lib/github-commit.ts`
8. `content_outputs.published_url` set to `https://client.website/blog/[slug]`

---

## Multi-Tenancy

Every user gets a `workspaces` row. All data tables have a `workspace_id` FK. RLS policies ensure users only see their own workspace rows.

- **Client-side (anon key):** RLS scopes queries automatically once authenticated.
- **Service role (API routes):** Bypasses RLS — routes explicitly filter by `workspace_id` or validate ownership before acting.
- **New sign-up flow:** After onboarding completes, `getOrCreateWorkspace()` is called, which seeds a default Ada agent and workspace settings row.

### Workspace Isolation in API Routes

User-triggered calls that include an `Authorization` header are validated against workspace ownership. The pattern:
1. Extract `Authorization` header from the request
2. Create an anon Supabase client with that header to resolve the calling user
3. Load the user's workspace via `workspaces.owner_id`
4. Compare `workspace.id` against the resource's `workspace_id` — return 403 if mismatch

Routes with this check: `/api/jobs/run`, `/api/jobs/[id]` (PATCH + DELETE), `/api/clients/[id]/overview`.

Cron-triggered calls (no `Authorization` header) bypass the user check — they are validated via `CRON_SECRET` / Vercel signature at `/api/schedule/check` instead.

---

## Directory Structure

```
src/
  app/
    globals.css
    layout.tsx
    (app)/
      layout.tsx
      page.tsx                     Dashboard — briefing room, stats, activity heatmap
      agents/
        page.tsx                   Agent cards with quick-nav pills
        [id]/
          page.tsx                 Chat + Settings tabs; full agentic tool loop
          queue/page.tsx           Queue filtered to this agent
          keywords/page.tsx        Keyword suggestions review (agent-scoped)
          calendar/page.tsx        Content calendar (agent-scoped)
          outputs/page.tsx         Outputs produced by this agent
          activity/page.tsx        Activity log filtered to this agent
      clients/
        page.tsx
        [id]/page.tsx              9 tabs: Profile / Keywords / Pages / Codebase /
                                   Connections (+ GSC) / Competitors / Schedule /
                                   Search Performance / Reports
      outputs/
        page.tsx
        [id]/page.tsx              Pipeline indicator, image gallery, approve, publish, edit
      reports/
        page.tsx                   Reports list + generate modal
        [id]/page.tsx              Full report detail (print-friendly)
      queue/page.tsx               Aggregate queue (all agents)
      keywords/page.tsx            Aggregate keyword suggestions
      calendar/page.tsx            Aggregate calendar
      activity/page.tsx            Aggregate activity log
      marketplace/page.tsx
      settings/page.tsx
    (auth)/
      login/page.tsx
      signup/page.tsx
      onboarding/page.tsx          5-step: Welcome → Add client → Connect site → Crawl → Meet Ada
  components/
    Sidebar.tsx                    Two-level nav: global items + per-agent sub-nav
    StatusBadge.tsx
  lib/
    supabase.ts                    Supabase anon client
    workspace.ts                   getWorkspaceId(), getOrCreateWorkspace(), getWorkspaceName()
    crypto.ts                      AES-256-GCM encrypt/decrypt (ENCRYPTION_KEY)
    gsc.ts                         getValidAccessToken(connectionId) — checks expiry, refreshes
    notifications.ts               sendNotification() — email via Resend + Slack webhook
    types.ts                       TypeScript types for all DB entities (OutputImage, Output, SiteConnection)
    github-commit.ts               atomicCommit() — Git Trees API multi-file commit, all blobs base64
    content-clean.ts               cleanContent() — em dash/smart quote normalisation
    theme.ts
  middleware.ts
  app/
    api/
      auth/
        google/route.ts            GET — initiate Google OAuth
        google/callback/route.ts   GET — exchange code, save tokens, redirect
        google/refresh/route.ts    POST — refresh expired GSC access token
        google/select-property/route.ts  POST — save chosen GSC property to google_connections
      workspace/
        api-key/route.ts           POST — encrypt + save workspace API keys server-side
      chat/route.ts
      crawl/route.ts
      github/route.ts
      connections/
        test/route.ts
        publish/route.ts
        read/route.ts
      gsc/
        sync/route.ts              POST — sync 90 days of Search Analytics; also upserts content_performance
        properties/route.ts        GET — list GSC properties for a google_connection
      intelligence/
        decay/route.ts             POST — detect ranking decline, create briefing items
        score-keywords/route.ts    POST — recalculate opportunity scores across keyword bank
      jobs/
        route.ts                   GET (list by client_id) / POST (create scheduled_job)
        [id]/route.ts              PATCH (update) / DELETE
        run/route.ts               POST — execute a scheduled_job immediately
      notifications/
        digest/route.ts            POST — send daily digest email + Slack per workspace
        output-ready/route.ts      POST — fire output_ready notification after Ada produces a draft
      reports/
        generate/route.ts          POST — generate monthly report with AI executive summary
      schedule/
        run/route.ts
        check/route.ts             Cron: schedules + GSC sync + monthly reports + digest + scheduled_jobs
      run-task/route.ts
docs/
  AGENCEE.md
vercel.json                       Cron: /api/schedule/check at 07:00 UTC daily
```

---

## Navigation

**Sidebar structure (two-level):**
- Dashboard (global)
- Clients (global)
- Outputs (global) → `/outputs`
- Reports (global)
- *[divider]*
- *For each active agent:*
  - Agent name + role header (links to chat)
    - Chat → `/agents/[id]`
    - Queue → `/agents/[id]/queue`
    - Calendar → `/agents/[id]/calendar` *(Ada only)*
    - Keywords → `/agents/[id]/keywords` *(Ada only)*
    - Activity → `/agents/[id]/activity`
- *[divider]*
- Settings

Outputs is a workspace-level global nav item (`/outputs`) — not per-agent. It shows all content_outputs across all agents with an Agent column (Ada/Theo). Agent `nav_items` in DB no longer include an Outputs entry.

Agent nav items are stored in `agents.nav_items` (JSONB array). The `[id]` placeholder is resolved to the actual agent ID at render time.

**Agents page quick-access:** Each agent card shows nav items as pill links beneath the card, making `/agents` a quick-access hub without needing to open the agent first.

---

## Pages

### Dashboard (`/`)
Briefing Room (proactive AI-generated cards: opportunity, decay, gap, suggestion, schedule). Stats row. Morning digest (drafts/running/queued counts). Activity heatmap. Token usage.

### Agent detail (`/agents/[id]`)
Two tabs:
- **Chat** — full conversation UI, streaming, parallel tool execution, planned tasks sidebar
- **Settings** — editable identity/personality fields

**URL persistence:** The active conversation is reflected in `?conversation=[id]`. On page load this param is read and the conversation loaded automatically. When a conversation is selected or created, the URL is updated via `window.history.replaceState` (no full navigation).

**Task log persistence:** The sidebar task log (tool steps) is encoded into assistant messages via `__META__...` prefix (see `encodeMessageMeta`/`decodeMessageMeta`). On `loadMessages`, the task log is restored from the last assistant message that used tools — so the task log survives page refreshes.

**Chat bubble filtering:** Only assistant messages with non-empty content are rendered (plus the live in-progress placeholder). Pure tool-use intermediate states do not produce empty bubbles.

### Client detail (`/clients/[id]`)
**AI Intelligence panel** — displayed above the tabs. Loads on mount; returns cached `client_profiles.ai_overview` if under 24h old, otherwise calls `POST /api/clients/[id]/overview` to generate a fresh Claude Haiku summary. Shows a "Refresh" link and last-updated timestamp. Shows a connect-GSC prompt if no GSC connection. Renders a skeleton loader while generating.

Nine tabs:
- **Profile** — all `client_profiles` fields
- **Keywords** — keyword bank table sorted by opportunity score; add keyword form
- **Pages** — crawled pages table
- **Codebase** — GitHub repo config + file tree
- **Connections** — site connections (WordPress, Shopify, Webflow, GitHub) + Google Search Console section (connect/sync/disconnect)
- **Competitors** — competitor URLs; crawl; expandable page view
- **Schedule** — autonomous cadence config; run now
- **Search Performance** — GSC data: summary cards (avg position, clicks, impressions). Queries/Pages toggle. Period filter (7d/28d/90d) for queries. Export CSV button. Queries view: position column with trend indicator vs 90d (↑/↓/→), Opportunity column (★★★ High / ★★ Medium / ★ Low for positions 5-15), "→ Brief Ada" button on near-miss rows (position 5-15, >50 impressions) navigates to `/agents/[ada-id]?brief=...`. Pages view: page-level breakdown from `__page__` rows, "Brief Ada on this page" button.
- **Reports** — all reports for this client; generate new report modal

### Output detail (`/outputs/[id]`)
3-step pipeline indicator (Draft / Approved / Published). SEO metadata bar (title/meta character badges). Image gallery (copy URL, broken image placeholder). Content panel with Preview/Edit segmented control — preview renders markdown via `marked`, edit is a 480px mono textarea. Sticky action bar changes by state: Draft (Approve / Send feedback to Ada / Delete), Approved (Publish now with connection selector / Revert to draft), Published (show live URL). Publish calls `POST /api/connections/publish`, shows spinner with "Transferring images…" message, verbatim error + Retry on failure.

### Reports (`/reports`)
List of generated reports. Generate modal (client + date range).

### Report detail (`/reports/[id]`)
Print-friendly. Sections: header, executive summary (AI-generated), content published, search performance, keyword coverage, near-miss opportunities. Print/PDF button triggers `window.print()`.

### Settings (`/settings`)
Workspace name + ID, Anthropic API key, Gemini API key, token budget, Notifications (email toggle, Slack webhook + test, event toggles, ranking threshold).

---

## API Routes

### Auth / Google OAuth
| Route | Method | Description |
|---|---|---|
| `/api/auth/google` | GET | Initiate OAuth — `?client_id=` — redirects to Google |
| `/api/auth/google/callback` | GET | Exchange code, save tokens, redirect to client detail |
| `/api/auth/google/refresh` | POST | Refresh expired access token |

### GSC
| Route | Method | Description |
|---|---|---|
| `/api/gsc/sync` | POST | Sync 90 days of Search Analytics for a client. Accepts `{ connection_id }` or `{ client_id }` |

### Intelligence
| Route | Method | Description |
|---|---|---|
| `/api/intelligence/decay` | POST | Detect ranking decline (position worsened >3 places, >50 impressions). Creates `briefing_items` of type `decay` |
| `/api/intelligence/score-keywords` | POST | Recalculate opportunity scores across all `keyword_banks` rows |

### Notifications
| Route | Method | Description |
|---|---|---|
| `/api/notifications/digest` | POST | Send daily digest (email + Slack) per workspace |

### Reports
| Route | Method | Description |
|---|---|---|
| `/api/reports/generate` | POST | Generate a report. Accepts `{ client_id, period_start, period_end }`. Returns `{ id }` |

### Jobs
| Route | Method | Description |
|---|---|---|
| `/api/jobs` | GET | List `scheduled_jobs` for a `client_id` (query param) |
| `/api/jobs` | POST | Create a new `scheduled_job`. Calculates `next_run_at` via `calculateNextRun()` |
| `/api/jobs/[id]` | PATCH | Update fields on a `scheduled_job`. Recalculates `next_run_at` if schedule params change |
| `/api/jobs/[id]` | DELETE | Delete a `scheduled_job` |
| `/api/jobs/run` | POST | Execute a job immediately by `{ job_id }`. Creates a `job_runs` row, dispatches by `job_type`, updates status on completion |

**`calculateNextRun(cadence, runDay, runHour)`** — shared helper in `/api/jobs/route.ts`:
- `daily` — next occurrence of `runHour` UTC
- `weekly` / `biweekly` — next (or following) `runDay` at `runHour` UTC
- `monthly` — 1st of next month at `runHour` UTC

**Job type dispatch in `/api/jobs/run`:**
| Job type | What it does |
|---|---|
| `gsc_intelligence` | Calls `POST /api/gsc/sync`, then `POST /api/intelligence/decay`, then `POST /api/intelligence/score-keywords`, then `POST /api/clients/[id]/overview` (refresh) |
| `keyword_research` | Runs `discoverKeywordsFromGSC()` with existing `search_performance` rows |
| `content` | Calls `POST /api/schedule/run`, then honours `content_autonomy` (auto_approve / full_autopilot) |
| `site_audit` | Calls `POST /api/crawl` |

Content autonomy in the job runner:
- `manual` — draft created; notification sent; Dan reviews
- `auto_approve` — output marked `approved: true`; `content_history` row inserted; "Auto-approved" badge shown in Outputs list
- `full_autopilot` — auto_approve + `POST /api/vercel/promote` to submit for production promotion

### Schedule / Cron
| Route | Method | Description |
|---|---|---|
| `/api/schedule/run` | POST | Process one due `client_schedules` entry |
| `/api/schedule/check` | GET | Cron: trigger due client_schedules + GSC sync + monthly reports + scheduled_jobs fan-out + digest |

`/api/schedule/check` now also queries `scheduled_jobs` where `enabled=true`, `next_run_at <= now()`, `last_run_status != 'running'` and fans out to `POST /api/jobs/run` for each. Returns `{ triggered, succeeded, jobs_triggered }` in response body.

### Clients
| Route | Method | Description |
|---|---|---|
| `/api/clients/[id]/overview` | POST | Generate or return cached AI overview for a client. Returns `{ overview, updated_at, cached }`. Uses `claude-haiku-4-5-20251001`. Cached for 24h in `client_profiles.ai_overview`. |

### Keywords
| Route | Method | Description |
|---|---|---|
| `/api/keywords/approve` | POST | Server-side approve: accepts `{ suggestion_id }`. Loads suggestion, builds `keyword_banks` insert with intent/funnel auto-detected, inserts with service key (bypasses RLS), updates suggestion status to `approved`. Returns `{ success, keyword_bank_id }`. |
| `/api/keywords/reject` | POST | Server-side reject: accepts `{ suggestion_id, reason? }`. Updates suggestion `status: 'rejected'` and stores reason in `metadata.reject_reason`. Returns `{ success }`. |

### Other
| Route | Method | Description |
|---|---|---|
| `/api/chat` | POST | Anthropic API proxy with prompt caching |
| `/api/crawl` | POST | Crawl client site or competitor URL. Resolves `workspace_id` via `google_connections`; stores on `site_pages`. |
| `/api/github` | GET | Read file from client GitHub repo (`?client_id=&path=`) |
| `/api/github` | POST | Sync file tree — fetches Git tree, saves to `client_profiles.file_tree` |
| `/api/github` | PUT | Write/update single file (Contents API) |
| `/api/github` | PATCH | Atomic multi-file commit via Git Trees API. Accepts `{ client_id, files: [{path, content, encoding?}], message }`. Delegates to `atomicCommit()` in `src/lib/github-commit.ts`. All content base64-encoded before send. |
| `/api/generate-image` | POST | Generate image via Gemini (`gemini-3-pro-image`), upload to Supabase Storage `blog-images` bucket. Accepts `{ prompt, filename?, client_id?, workspace_id? }`. Returns `{ url, filename, storage_path, mime_type }`. Never touches GitHub. |
| `/api/connections/test` | POST | Test a site connection |
| `/api/connections/publish` | POST | Publish approved output to a platform. Accepts `{ output_id, connection_id? }`. Idempotent (returns existing if already published). GitHub MDX flow: downloads images from Supabase → rewrites URLs to `/assets/filename` → atomic commit (MDX + images). WordPress: marked → HTML → sideload media → REST API. Shopify: markdown → HTML → Articles API. `export const maxDuration = 120`. |
| `/api/connections/read` | GET | Read content items from a platform |
| `/api/outputs/[id]` | DELETE | Delete output: removes Storage images, deletes `output_versions`, deletes `content_outputs` row |
| `/api/run-task` | POST | Manual queue task runner |

---

## Database Schema

### `workspaces`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| owner_id | uuid | FK → auth.users |
| created_at | timestamptz | |

### `client_profiles`
workspace_id FK. Columns: id, name, slug, industry, website, description, icp, usp, competitors (text[]), brand_voice, content_goals, top_performing_content, last_crawled_at, github_synced_at, github_repo, github_branch, github_token, file_tree, **ai_overview** (text), **ai_overview_updated_at** (timestamptz), **content_autonomy** (text), created_at, updated_at.

**Extended client fields (added in Feature Brief 4):**
| Column | Type | Purpose |
|---|---|---|
| `pricing_info` | text | Pricing details — used in Ada's client context and blog post CTAs |
| `team_info` | text | Named practitioners and qualifications — required for E-E-A-T health content |
| `trust_signals` | text | Credentials, certifications, compliance — included in Ada's system prompt |
| `service_differentiators` | text | Unique selling points beyond USP — geographic exclusivity, method, access |
| `location_info` | text | Coverage area description — drives local SEO and image generation settings |
| `target_keywords` | text | Core keyword set — comma-separated; referenced in Ada's client context |
| `content_tone` | text | Tone guidelines — included in Ada's voice section |
| `avoid_topics` | text | Editorial restrictions — hard rules Ada must not violate |
| `cta_approach` | text | CTA style instructions — location-specific soft CTA format |
| `schema_type` | text | JSON-LD schema type: LocalBusiness / MedicalBusiness / ProfessionalService / HealthAndBeautyBusiness |

All new fields are surfaced in the client Profile tab as collapsible sections (Brand & Voice, Business Details, SEO & Locations) with auto-save on blur.

`ai_overview` — AI-generated 3-4 sentence strategic summary. Updated by `POST /api/clients/[id]/overview`. Cached for 24h.

`content_autonomy` — Controls how autonomously the job runner publishes content:
- `manual` (default) — job creates draft; Dan reviews and approves manually
- `auto_approve` — job auto-approves outputs (marks `approved: true`) and inserts a `content_history` row; still requires manual publish
- `full_autopilot` — auto-approves + calls `POST /api/vercel/promote` to promote the latest preview deployment to production

### `agents`
workspace_id FK. Columns: id, name, role, slug, avatar_initials, description, backstory, expertise, personality, communication_style, working_style, boundaries, instructions, agent_type, active, nav_items (jsonb).

`nav_items` schema:
```json
[{"label": "Chat", "path": "/agents/[id]", "icon": "chat"}, ...]
```

### `keyword_banks`
workspace_id FK. Columns: id, client_id, keyword, cluster, intent, funnel_stage, monthly_volume, difficulty, current_position, priority, content_targeting_this, **opportunity_score** (integer), created_at.

### `content_queue`
workspace_id FK. Columns: id, client_id, agent_type, content_type, primary_keyword, supporting_keywords, title_brief, word_count, scheduled_for, status (queued/running/done/failed/review), output_id, calendar_id, error, created_at.

### `content_outputs`
workspace_id FK. Columns: id, client_id, queue_item_id, agent_type, title, content, primary_keyword, meta_description, word_count, approved, published_url, notes, current_version, source, created_at.

**Extended columns (content pipeline rebuild):**
| Column | Type | Notes |
|---|---|---|
| `format` | text | `'markdown'` for Ada-written posts (default), `'typescript'` legacy |
| `images` | jsonb | Array of `{ url, alt_text?, filename?, storage_path? }` — Supabase Storage URLs |
| `platform_output` | jsonb | `{ platform?, publish_id?, committed_at? }` — set on publish |
| `scheduled_publish_at` | timestamptz | Reserved for future scheduled publish |
| `last_edited_at` | timestamptz | Updated on content edits |

`content_outputs` is the **single source of truth** for content. The row is created immediately when Ada calls `write_content` — before any GitHub I/O. Content is never lost even if publishing fails.

### `content_history`
workspace_id FK. Columns: id, client_id, title, url, primary_keyword, summary, published_at, performance_notes, ranking_position, ranking_date, traffic_notes, created_at.

### `workspace_settings`
workspace_id FK. Columns: id, user_id, workspace_id, workspace_name, anthropic_api_key, gemini_api_key, monthly_token_budget, tokens_used_this_month, onboarding_completed, created_at, updated_at.

### `conversations` / `messages` / `planned_tasks`
workspace_id FK on each. Standard chat/planning tables.

### `site_pages`
workspace_id FK. Columns: id, workspace_id, client_id, url, title, h1, meta_description, word_count, content, content_summary, internal_links, crawled_at. `workspace_id` is populated from `google_connections` on crawl.

### `site_connections`
workspace_id FK. Columns: id, client_id, platform (github/wordpress/shopify/webflow), label, config (jsonb), status, last_tested_at, created_at.

### `google_connections`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | |
| client_id | uuid FK | |
| google_account_email | text | |
| property_url | text | GSC property URL |
| access_token | text | AES-256-GCM encrypted |
| refresh_token | text | AES-256-GCM encrypted |
| token_expires_at | timestamptz | |
| connected_at | timestamptz | |
| last_synced_at | timestamptz | |
| status | text | active/error/revoked |

### `search_performance`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id, client_id | uuid FK | |
| query | text | Regular query string, or reserved: `__total__` (aggregate totals), `__page__` (page-level breakdown), `__device__` (device breakdown) |
| page | text | URL for query rows; `__total__` for total rows; device type (MOBILE/DESKTOP/TABLET) for device rows |
| clicks, impressions | integer | |
| ctr, position | numeric | |
| period_start, period_end | date | |
| synced_at | timestamptz | |

Reserved `query` values:
- `__total__` — true GSC aggregate totals (unaffected by privacy thresholds); one row per period
- `__page__` — page-level data from `dimensions: ['page']`; 28d only; `page` = full URL
- `__device__` — device breakdown from `dimensions: ['device']`; 28d only; `page` = MOBILE/DESKTOP/TABLET

### `briefing_items`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id, client_id | uuid FK | |
| type | text | opportunity/decay/gap/suggestion/schedule |
| title, body | text | |
| action_label, action_url | text | |
| priority | integer | 1 = highest |
| dismissed, dismissed_at | boolean/timestamptz | |
| created_at | timestamptz | |

Unique constraint: `(workspace_id, client_id, title)` — used by GSC sync near-miss upserts.

### `keyword_suggestions`
workspace_id FK. Columns: id, client_id, keyword, rationale, cluster, monthly_volume_estimate, difficulty_estimate, intent, funnel_stage, status (pending/approved/rejected), suggested_by, source, metadata, created_at.

- `source` (text) — `gsc_discovery` / `ada` / `competitor_gap`
- `metadata` (jsonb) — GSC context at discovery time: `{ position, impressions, clicks }`
- `status` values: `pending` (awaiting review), `approved` (added to keyword bank), `rejected` (declined with reason)
- Rejected suggestions are excluded from re-discovery — once rejected, `discoverKeywordsFromGSC` will never re-propose the same keyword

### `content_calendar`
workspace_id FK. Columns: id, client_id, title, primary_keyword, content_type, scheduled_date, status (planned/in_progress/published/cancelled), notes, output_id, queue_item_id, created_at.

### `client_schedules`
workspace_id FK. Columns: id, client_id, agent_id, enabled, cadence, content_types, target_word_count, notes, last_run_at, next_run_at, created_at, updated_at.

### `scheduled_jobs`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | |
| client_id | uuid FK | |
| name | text | Human-readable label |
| job_type | text | `gsc_intelligence` / `content` / `keyword_research` / `site_audit` / `custom` |
| description | text | Optional notes |
| enabled | boolean | default true |
| cadence | text | `daily` / `weekly` / `biweekly` / `monthly` |
| run_day | text | Day of week (e.g. `monday`) — used for weekly/biweekly |
| run_hour | integer | Hour of day UTC (0–23) |
| next_run_at | timestamptz | Calculated by `calculateNextRun()` |
| last_run_at | timestamptz | |
| last_run_status | text | `running` / `success` / `failed` / null |
| last_run_summary | text | Human-readable summary of last run |
| created_at | timestamptz | |

### `job_runs`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| job_id | uuid FK → scheduled_jobs | |
| workspace_id | uuid FK | |
| client_id | uuid FK | |
| job_type | text | Copy of job_type at run time |
| status | text | `running` / `success` / `failed` |
| summary | text | Result summary (e.g. "Generated 1 draft", "Synced 278 rows") |
| error | text | Error message if failed |
| started_at | timestamptz | |
| completed_at | timestamptz | |

### `output_versions`
workspace_id FK. Columns: id, output_id, version_number, content, title, meta_description, word_count, edited_by (human/ada/system), created_at.

### `agent_activity`
workspace_id FK. Columns: id, agent_id, client_id, action, detail, tokens_used, created_at.

### `content_performance`
workspace_id FK. Schema-only — no data collection UI yet. Columns: id, output_id, client_id, url, keyword, position, impressions, clicks, recorded_at.

### `competitor_sites` / `competitor_pages`
workspace_id FK on each. Standard competitor tracking tables.

### `notification_preferences`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | |
| email_enabled | boolean | default true |
| slack_webhook_url | text | |
| slack_enabled | boolean | |
| notify_output_ready | boolean | |
| notify_ranking_change | boolean | |
| notify_ranking_threshold | integer | default 3 |
| notify_schedule_complete | boolean | |
| notify_schedule_failed | boolean | |
| notify_keyword_suggestions | boolean | |
| digest_time | integer | hour of day UTC |
| created_at | timestamptz | |

### `notification_log`
workspace_id FK. Columns: id, workspace_id, type, channel (email/slack), subject, body, sent_at, error.

### `reports`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id, client_id | uuid FK | |
| period_start, period_end | date | |
| title | text | |
| status | text | draft/ready/sent |
| data | jsonb | Cached report data at generation time |
| pdf_url | text | Not yet implemented |
| created_at | timestamptz | |

---

## RLS Policies

All tables have RLS enabled. Pattern:

```sql
-- Users can only see rows in their own workspace
create policy "workspace_isolation" on <table>
  for all using (
    workspace_id in (select id from workspaces where owner_id = auth.uid())
  );
```

Service role (`SUPABASE_SERVICE_KEY`) bypasses RLS in all API routes.

---

## Key Libraries

### `src/lib/workspace.ts`
- `getWorkspaceId()` — returns workspace ID for current user, or null
- `getOrCreateWorkspace()` — creates workspace + default Ada agent + workspace settings if none exists; returns ID
- `getWorkspaceName()` — returns workspace name

### `src/lib/crypto.ts`
AES-256-GCM encrypt/decrypt using `ENCRYPTION_KEY` env var (32 bytes, base64). Used to store OAuth tokens. Exports `encrypt(text)`, `decrypt(data)`, `safeDecrypt(data)` (null on error).

### `src/lib/gsc.ts`
`getValidAccessToken(connectionId)` — loads `google_connections`, checks `token_expires_at`, calls `/api/auth/google/refresh` if expired, returns valid access token.

### `src/lib/notifications.ts`
`sendNotification({ workspaceId, type, subject, body, slackBlocks?, actionUrl? })`:
1. Loads `notification_preferences` for workspace
2. Gets user email via `supabase.auth.admin.getUserById(workspace.owner_id)`
3. Sends email via Resend (`RESEND_API_KEY`), from `notifications@agencee.app`. If `actionUrl` is provided, a "Review content →" button is included in the email HTML.
4. Sends Slack via webhook if configured
5. Logs to `notification_log`

---

## Agent System

### Tools Available to Agents

Agent tools are assigned dynamically by `agent_type` in `getToolsForAgent()` in `agents/[id]/page.tsx`.

**Shared tools (all agents):**
- `search_history`, `get_site_pages`, `get_keywords`, `read_file`, `read_page`, `audit_site`

**Ada tools (`agent_type: 'content'`):**
- `generate_images` — uploads to Supabase Storage `blog-images`, returns `{ url, filename, storage_path }[]`
- `write_content` — accepts `{ title, content (markdown+frontmatter), primary_keyword, meta_description, images[], client_id }`. Creates `content_outputs` row immediately (format: 'markdown'), fires output-ready notification, returns `{ success, output_id, review_url }`
- `save_planned_task`, `update_planned_task`
- `analyse_gsc`, `suggest_keyword`, `create_content_plan`, `analyse_competitors`, `suggest_internal_links`

**Theo tools (`agent_type: 'technical'`):**
- `publish_content` — accepts `{ output_id, connection_id? }`. Calls `POST /api/connections/publish`. Requires output to be in `approved` state.
- `write_file` — single-file GitHub write via `PUT /api/github`

**Removed tools:**
- `append_blog_post` — replaced by `write_content` + `publish_content` separation
- `generate_image` (singular) — replaced by `generate_images` (plural, Supabase-backed)

### Theo Agent

`agent_type: 'technical'`. Seeded alongside Ada in the workspace. Handles the technical publishing half of the pipeline — Ada writes, Theo publishes. Theo has `write_file` for ad-hoc file writes and `publish_content` to push approved outputs to connected platforms.

### Ada's System Prompt Architecture
The system prompt contains ONLY:
- Ada's personality, expertise, working style, boundaries
- Current client profiles — includes all extended fields (tone, avoid_topics, cta_approach, pricing_info, team_info, trust_signals, service_differentiators, location_info, target_keywords, schema_type) — each only if non-empty
- CLIENT DISAMBIGUATION block — lists workspace clients; Ada asks "Which client is this for?" on ambiguous requests
- CONTENT FORMAT section — markdown with YAML frontmatter contract: `title, slug, description, keyword, category, reading_time, date, image, image_alt`
- WORKFLOW section — 7-step workflow ending with `write_content` call
- MANDATORY RESEARCH block — before answering any content question, Ada MUST call `search_history`, `get_site_pages`, and `analyse_gsc` in a single parallel response before giving recommendations. Exception: purely conversational/educational messages.
- IMAGE GENERATION rules — 6 numbered rules for documentary-style images; GOOD/BAD examples
- RESPONSE STYLE: conversational, markdown-aware, no filler, UK English, no em dashes
- LENGTH: conversational 2-4 sentences, keyword analysis 150-300 words, full plan up to 500 words

**Not in system prompt:** keyword bank, site pages, content history, GSC data, file tree, TypeScript format rules. All fetched on-demand via tools.

### Ada Chat Markdown Rendering
Assistant messages are rendered with `marked` (gfm + breaks). The bubble div uses `className="ada-message-content"` with `dangerouslySetInnerHTML`. CSS class defined in `globals.css`. User messages remain plain text.

### Image Generation

Gemini model: **`gemini-3-pro-image`** — do NOT change this. `responseModalities: ['IMAGE', 'TEXT']`, inlineData extraction. Images are uploaded to Supabase Storage `blog-images` (public bucket) — never committed to GitHub directly.

### Image Generation — Prompt Enhancement
When Ada calls `generate_images`, the handler automatically appends client-context style requirements to each prompt before sending to the Gemini API:

- **Location:** pulled from `client_profiles.location_info` (e.g. "a real home in Newcastle")
- **Audience:** pulled from `client_profiles.icp` (first 200 chars)
- **Brand feel:** pulled from `client_profiles.content_tone` or `brand_voice`

The enhancement appends: `STYLE REQUIREMENTS: [context]. Natural home environment, never clinical. Warm, documentary photography style. Natural lighting. Real, unstaged feel. No white coats or clinical equipment. High quality, editorial standard.`

This means Ada only needs to write scene-level prompts — the client context injection handles brand consistency automatically.

### Ada's Proactive GSC Analysis
Ada calls `analyse_gsc` before making any content recommendations in a conversation (unless the first message is purely conversational). Exception: greetings/admin questions.

### Ada's ?brief= URL params
Navigating to `/agents/[id]?brief=[query]&position=[X]&impressions=[N]` pre-populates the chat input and auto-sends: "I want to push '[query]' from position [X] to page 1. It's currently getting [N] impressions. Analyse this keyword and recommend a content approach."

After every successful `append_blog_post` or `write_file`, Ada calls `suggest_internal_links` automatically.

---

## Google Search Console Integration

**OAuth flow:**
1. User clicks "Connect Search Console" on client detail Connections tab
2. `/api/auth/google?client_id=[id]` redirects to Google OAuth
3. Callback exchanges code, fetches email + properties
4. Tokens encrypted with AES-256-GCM and stored in `google_connections`
5. If multiple properties → redirect to `/clients/[id]/gsc-setup` for selection

**Data sync (`POST /api/gsc/sync`):**
- Fetches 7d/28d/90d Search Analytics (query+page dimensions, 1000 rows each)
- **Page-level breakdown** (28d only): `dimensions: ['page']`, 200 rows. Stored as `query='__page__'`, `page=URL`. Powers the Pages view on the Search Performance tab.
- **Device breakdown** (28d only): `dimensions: ['device']`, 10 rows. Stored as `query='__device__'`, `page=device type`.
- **Near-miss briefing_items**: top 20 near-misses (position **3-20**, **>15** impressions) from 28d data are upserted into `briefing_items` (type=`opportunity`) unless a `planned_tasks` row already targets that keyword.
- **Low-CTR briefing_items**: queries at position 1-10 with CTR < 3% and >30 impressions are upserted as additional opportunity items.
- **GSC keyword discovery**: passes combined deduped rows from all 3 periods (7d/28d/90d) to `discoverKeywordsFromGSC()`. Threshold lowered to **>5 impressions** (was >30). No `.slice(0, 15)` cap. Also excludes rejected suggestions so they are never re-proposed.
- Deletes and re-inserts `search_performance` rows for the client
- Updates `content_history.ranking_position` for matching URLs
- Updates `keyword_banks.current_position` for matching keywords

**Ada's context:** GSC data is no longer in the system prompt. Ada fetches it on-demand via `analyse_gsc` tool.

**Daily sync:** `/api/schedule/check` triggers sync for all connections not synced in 23h.

---

## Intelligence & Briefing Room

### Opportunity Scoring
`keyword_banks.opportunity_score` (0–100), recalculated by `POST /api/intelligence/score-keywords`:
- Base: 50
- GSC position: ≤3 → -20, ≤10 → +10, ≤20 → +30, ≤50 → +15, unranked → +5
- Volume: >1000 → +20, >500 → +15, >100 → +10
- KD: <20 → +15, <40 → +10, <60 → +5, ≥60 → -5
- Content targeting this keyword: -25
- Priority bonus: (10 - priority) × 2

Displayed as a colored bar on keyword bank tables: green (70–100), amber (40–69), grey (0–39).

### Decay Detection (`POST /api/intelligence/decay`)
Compares current vs previous 28-day average position per query. Creates `briefing_items` of type `decay` for queries worsening >3 places with >50 impressions.

### Briefing Room (Dashboard)
Loads all undismissed `briefing_items` (up to 50) ordered by priority. Shows top 3 cards by default; "Show N more →" expands all inline; "Show less" collapses. Header shows opportunity count and "Dismiss all" button. Cards use a compact one-line data format: badge (OPPORTUNITY/DECAY/GAP/SUGGESTION) + keyword + position/impressions summary. Empty state: "Everything looks good. No actions needed right now." Badge colours: OPPORTUNITY `rgba(79,127,255,0.15)` / DECAY `rgba(245,158,11,0.15)` / GAP `rgba(139,92,246,0.15)` / SUGGESTION `rgba(34,197,94,0.15)`.

---

## Notifications

### Channels
- **Email:** Resend API (`RESEND_API_KEY`), from `notifications@agencee.app`
- **Slack:** Incoming webhook URL stored in `notification_preferences.slack_webhook_url`

### Triggers
| Event | When | Subject |
|---|---|---|
| `output_ready` | After Ada calls `write_content` tool | "Content ready for review — [Title]" |
| `schedule_complete` | After successful `/api/schedule/run` | "Scheduled run complete — [Client]" |
| `schedule_failed` | On error in `/api/schedule/run` | "Scheduled run failed — [Client]" |
| `daily_digest` | Daily cron via `/api/notifications/digest` | Morning summary |

### Daily Digest Format
Per workspace: new drafts count, ranking changes above threshold, pending keyword suggestions, next scheduled run. Formatted as Slack blocks + HTML email.

---

## Autonomous Scheduling

### Legacy client schedules
**Per-client cadence:** legacy `client_schedules` table — Select agent, cadence (daily/weekly/biweekly/monthly), content type, word count.

### Scheduled Jobs (new)
The Schedule tab on client detail has been replaced with a full **Job Manager** UI supporting multiple job types per client, each with independent cadence, history, and run controls.

**Job Manager UI (Schedule tab):**
- Lists all `scheduled_jobs` for the client with enabled/disabled toggle, last-run status badge, next-run time, and Delete button
- "Recent runs" panel below shows last 10 `job_runs` rows with status, summary, and timestamp
- Inline 3-step wizard to create a new job:
  1. **Type** — select job type (GSC Intelligence / Content / Keyword Research / Site Audit)
  2. **Schedule** — cadence, run day, run hour
  3. **Name** — name and optional description
- "Run now →" button on each job row triggers an immediate execution via `POST /api/jobs/run`

**Cron flow (07:00 UTC daily via `/api/schedule/check`):**
1. Find all enabled `client_schedules` where `next_run_at <= now()` → fan out to `POST /api/schedule/run`
2. Sync GSC for all connections not synced in 23h
3. On 1st of month: auto-generate reports for all clients with prior-month outputs
4. Find all enabled `scheduled_jobs` where `next_run_at <= now()` and `last_run_status != 'running'` → fan out to `POST /api/jobs/run`
5. Send daily digest

### Content Autonomy
Configured via radio buttons in the **Profile tab** of client detail (bottom panel labelled "Content autonomy"):

| Mode | Label | Behaviour |
|---|---|---|
| `manual` | Manual review | Draft created; Dan approves manually |
| `auto_approve` | Auto-approve | Output marked approved automatically; content_history row inserted |
| `full_autopilot` | Full autopilot | Auto-approve + `POST /api/vercel/promote` to push to production |

The `content_autonomy` field is saved to `client_profiles` and read by `POST /api/jobs/run` when the job type is `content`.

---

## Reporting

**Generation (`POST /api/reports/generate`):**
Loads client profile, approved outputs, search performance, keyword bank, agent activity, content history for the period. Generates a 3-sentence executive summary via `claude-sonnet-4-6`. Saves to `reports` with status `ready`.

**Report detail (`/reports/[id]`):**
Print-friendly layout. Sections: header, executive summary, content published, search performance (if GSC), keyword coverage progress bar, near-miss opportunities, print button.

**Auto-generation:** On the 1st of each month, cron auto-generates reports for all clients with published content in the previous month.

---

## Atomic Commit Library (`src/lib/github-commit.ts`)

`atomicCommit({ owner, repo, branch, token, files, message })` — commits multiple files in a single Git Trees API operation. Used by `PATCH /api/github` and `POST /api/connections/publish`.

```typescript
type CommitFile = { path: string; content: string; encoding?: 'utf-8' | 'base64' }
```

**Flow:** GET ref HEAD sha → GET base tree sha → POST blobs → POST tree (base_tree + items, mode 100644) → POST commit → PATCH ref.

**Critical:** ALL blobs are sent as base64, regardless of content type. Text files: `Buffer.from(content, 'utf8').toString('base64')`. Files already base64: pass through. The Git Trees API rejects `encoding: 'utf-8'`; sending raw text corrupts the blob silently.

Returns `{ commit_sha }`.

## Image Storage

Images generated by Ada are stored in Supabase Storage bucket `blog-images` (public).

- Path: `{workspace_id}/{client_id}/{slug}.webp`
- Returns: `{ url, filename, storage_path, mime_type }`
- On publish to GitHub: images are downloaded from Supabase via `fetch()` → arrayBuffer → base64, committed alongside the MDX file as `public/assets/{filename}`
- Supabase image URLs are rewritten to `/assets/{filename}` in the published MDX content

## Content Clean Utility (`src/lib/content-clean.ts`)

`cleanContent(content)` — applied before saving generated content:
- Replaces em dashes (` — `, `—`, ` -- `) with `, `
- Normalises smart quotes to straight quotes
- Collapses 3+ consecutive newlines to 2

---

## Design Tokens (Light Mode)

| Token | Value |
|---|---|
| Background | `#F8F9FB` |
| Surface | `#FFFFFF` |
| Surface-2 | `#F2F4F8` |
| Surface-3 | `#E8ECF2` |
| Border | `#E2E6EE` |
| Border-bright | `#C8D0E0` |
| Text | `#0F1520` |
| Text-2 | `#5A6A82` |
| Text-dim | `#8A9AB2` |
| Accent | `#4F7FFF` |
| Accent-hover | `#3A6AEE` |
| Green | `#0F9D6E` |
| Amber | `#D97706` |
| Red | `#DC2626` |
| Purple | `#7C3AED` |
| Display font | Instrument Serif italic |
| Body font | Inter |
| Mono font | JetBrains Mono |

`html { color-scheme: light }` — full light mode. All dark hex values replaced with CSS vars.

Animations: `pulse-ring` (running agent avatar), `breathe` / `breathe-fast` (sidebar status line).

---

## Current Client: Hear Better

- Client ID: `d46432ec-520c-4b16-8752-9b3f3b908f79`
- Website: `https://hearbetternow.co.uk`
- GitHub repo: `https://github.com/cnvrtagency/wireframe-whisperer-89`
- Branch: `main`

### Blog: dual-format support

Legacy TypeScript posts remain in `next-public/content/blogPosts/[slug].tsx` and are registered in `blogContent.tsx`. **New posts from Ada are MDX** — dropped into `next-public/content/posts/[slug].mdx`.

**MDX format:** frontmatter + markdown body. MDX posts are served by `next-public/lib/mdxPosts.ts` (`getMdxPosts`, `getMdxPost`, `mdxPostToBlogCardPost`).

**Frontmatter contract:**
```yaml
---
title: "Post title"
description: "Meta description and excerpt"
category: "Ear Health"
reading_time: "4 min read"
date: "2026-06-11"
image: "/assets/blog-filename.webp"
image_alt: "Descriptive alt text"
slug: "optional-override"
---
```

`blog/[slug]/page.tsx` tries MDX first, falls back to TypeScript registry. MDX posts get full SEO (article JSON-LD, indexable) — they do not hit the `noindex: true` fallback.

`blog/page.tsx` merges both sources sorted by `date` descending. MDX wins on slug collision.

**On publish:** `POST /api/connections/publish` for the GitHub connection commits the MDX file to `next-public/content/posts/{slug}.mdx` and images to `next-public/public/assets/`. One atomic commit, one Vercel build.

Image URL rewriting: all Supabase image URLs are replaced with `/assets/{filename}` in both the markdown body and the frontmatter `image:` field. The frontmatter `image:` rewrite uses an explicit regex after the body replace loop (`/^(image:\s*["']?)https?:\/\/...$/m`) to handle any URL format mismatch.

---

## Google Search Console — Multi-Property Flow

After OAuth callback, if the connected account has multiple GSC properties, the callback redirects to `/clients/[id]/gsc-setup`. This page:
1. Calls `GET /api/gsc/properties?connection_id=...` → fetches property list from Google Webmasters API
2. Shows a property picker UI
3. On confirm, calls `POST /api/auth/google/select-property` to save `site_url` to `google_connections`
4. Redirects back to `/clients/[id]`

---

## Workspace API Key Routing

Settings page encrypts API keys server-side via `POST /api/workspace/api-key`. The chat route loads `workspace_settings.anthropic_api_key`, decrypts it with `safeDecrypt`, and uses it in place of `process.env.ANTHROPIC_API_KEY` if set. Falls back to env var if not set. Same pattern to be applied to `run-task` and `schedule/run` routes.

---

## Per-Client Token Tracking

After each Claude API call in `/api/chat`, the route inserts an `agent_activity` row with: `workspace_id`, `client_id` (from request body), `agent_id`, `action: 'chat'`, `tokens_used` (input + output tokens from usage object).

---

## Keyword Suggestions Flow

### Discovery (`discoverKeywordsFromGSC` — `src/lib/gsc-keywords.ts`)
Called after every GSC sync with combined deduped rows from all 3 periods (7d/28d/90d — best row per query by impressions).

Thresholds:
- Impressions: **> 5** (was > 30)
- No cap on number of candidates (was `.slice(0, 15)`)

Exclusion set — keyword already in any of:
- `keyword_banks` (already tracked)
- `keyword_suggestions` status=`pending` (already proposed)
- `keyword_suggestions` status=`rejected` (explicitly declined — never re-proposed)

Each inserted suggestion gets `source: 'gsc_discovery'` and `metadata: { position, impressions, clicks }`.

### Review UI (`/agents/[id]/keywords`)
- **Approve/Reject** — handlers call `/api/keywords/approve` and `/api/keywords/reject` (server-side, service key) to bypass RLS on `keyword_banks`.
- **Approve** — intent/funnel auto-detected from keyword text:
  - Contains `near me|book|cost|price` → `commercial` / `bottom` funnel
  - Contains `what|how|why|does` → `informational` / `top` funnel
  - Fallback to suggestion's stored `intent` or `commercial`
  - `opportunity_score` based on GSC position: ≤10 → 60, ≤20 → 75, else 50
  - Inserts into `keyword_banks` with full metadata, removes from suggestions list
- **Reject** — inline reason input field appears below the row; submitting sets `status: 'rejected'` with reason in rationale; row fades out
- **Un-reject** — "Un-reject" button in the Rejected tab restores status to `pending`
- **Toast notifications** — green "Approved ✓ [keyword]" / amber "Rejected [keyword]" toasts appear top-right with 2.5s auto-dismiss
- **Fade animation** — approved/rejected rows fade out over 350ms before being removed from state
- **"View suggestions →"** link in the client detail Keywords tab header navigates to the agent's keyword suggestions page

---

## UI Changes Summary

### Dashboard — Pending Review Panel
Each pending output row now has three inline actions with CSS fade transitions:
- **Approve ✓** (green) — marks `approved: true`, inserts `content_history` row, fades row out
- **Review →** (accent) — opens `/outputs/[id]`
- **Delete ✗** (red) — shows "Sure?" confirmation state, then deletes and fades row out

Implemented as a `PendingOutputRow` component with `approving`, `deleting`, `confirmDelete`, and `fading` states.

Briefing Room badge now uses `briefingTotal` (total undismissed count) rather than the visible `briefingItems.length`.

### Agent Chat — Quick Action Chips
The duplicate plain-text chip row (shown while not sending) has been removed. Only the emoji quick-action chip row (shown when `messages.length === 0`) remains.

### Client Detail — Connections Tab
Badge count sums `site_connections.length + (gscConn ? 1 : 0)` so the Google Search Console connection is included.

### Client Detail — Competitors Tab
- URL validation before save (must start with `http://` or `https://`)
- `workspace_id` resolved from DB (via `google_connections` or `site_connections`) rather than client-side
- Optimistic add with `justAddedCompId` state — shows "Crawl now →" inline button immediately after adding
- Error alert on failure with rollback

### Client Detail — Schedule Tab
Replaced static cadence config with full Job Manager UI (see Autonomous Scheduling section above).

### Client Detail — Profile Tab
Three new collapsible sections below the main profile panel. Each section has a clickable header (▶/▼ triangle) and auto-saves textarea fields on blur. A "Saved ✓" indicator appears for 2 seconds after each save.

- **Brand & Voice** — `content_tone` and `avoid_topics` textareas
- **Business Details** — `pricing_info`, `team_info`, `trust_signals`, `service_differentiators`, `cta_approach` textareas
- **SEO & Locations** — `location_info`, `target_keywords` textareas; `schema_type` dropdown (LocalBusiness / MedicalBusiness / ProfessionalService / HealthAndBeautyBusiness)

Brand & Voice defaults open; Business Details and SEO & Locations default collapsed.

"Content autonomy" panel below the collapsible sections with three radio options: Manual review / Auto-approve / Full autopilot. Saves immediately to `client_profiles.content_autonomy`.

### Outputs List (`/outputs`)
Workspace-level page — shows all `content_outputs` across all agents with no agent_type filter.

Three tabs: **Drafts / Approved / Published** with live counts.

Each row: 48px thumbnail (first image, SVG document glyph fallback), title/client, keyword, agent (Ada/Theo in mono), "N words · M images" in mono, date, status pill, inline actions.

Inline actions per status:
- **Draft:** Approve ✓ (fades row out 350ms, inserts `content_history`) / Review → / Publish ↑ (single connection only)
- **Approved:** Publish ↑ / View →
- **Published:** View live →

Source badges:
- **Scheduled** (amber) — `source === 'scheduled'`
- **Queue** (accent blue) — `source === 'queue'`
- **Chat** (purple) — `source === 'conversation'`
- **Auto-approved** (green) — `approved === true && !source`
- **Manual** (grey) — fallback

---

## Content Clean Utility

`src/lib/content-clean.ts` — `cleanContent(content: string): string`

Applied deterministically before saving generated content:
- Replaces em dashes (` — `, `—`, ` -- `) with `, `
- Normalises smart quotes to straight quotes
- Collapses 3+ consecutive newlines to 2

Applied in:
- `agents/[id]/page.tsx` — `write_content` tool handler (before inserting `content_outputs`)
- `api/run-task/route.ts` — queue worker before saving to `content_outputs`
- `outputs/[id]/page.tsx` — `saveEdit` before saving edited content

---

## Content Calendar UI

Calendar page (`/agents/[id]/calendar`) has two sections:

**Content Plan Generator panel:**
- Client selector, Timeframe (2w/4w/8w), Posts/week (1/2/3/4), optional Focus input
- Sends a structured prompt to Ada via `/api/chat` to call `create_content_plan` for each item
- Streams Ada's response inline; reloads calendar after completion

**Calendar list:**
- Grouped by week of `scheduled_date` / `suggested_publish_date`
- Status flow indicator: Suggested · Approved · Scheduled · Written · Published with counts
- Filter by status and client
- Actions: Approve → `status='approved'`, Schedule → creates `content_queue` row, Dismiss → `status='cancelled'`
- Bulk select with sticky "Approve all" / "Schedule all" bar

---

## Approval Flow

In `/outputs/[id]`:
- Draft state: "Approve" + "Send feedback to Ada" + "Delete"
- Approved state: "Publish now" (connection selector) + "Revert to draft"
- Published state: no actions, shows live URL

Publish flow:
1. Select connection (dropdown with all workspace connections for the client)
2. Click "Publish now" → `POST /api/connections/publish { output_id, connection_id }`
3. Spinner shown with "Transferring images and committing content. This can take up to a minute."
4. On error: verbatim error message shown above action bar + [Retry publish] button
5. On success: `published_url` set, pipeline indicator advances to Published

In `/outputs` list:
- Tabs: Drafts / Approved / Published with live counts
- Approve ✓ inline (fades row, inserts `content_history`)
- Delete via `/api/outputs/[id]` DELETE (removes Storage images + DB rows)

---

## Security

### Token Encryption
All OAuth tokens (Google access + refresh) and GitHub personal access tokens are stored AES-256-GCM encrypted in the database. Encryption uses `ENCRYPTION_KEY` (32 bytes, base64-encoded). Implemented in `src/lib/crypto.ts`:
- `encrypt(text)` — returns `iv:ciphertext` hex string
- `decrypt(data)` — decodes and decrypts; throws on invalid input
- `safeDecrypt(data)` — wraps decrypt; returns null on error

**Backward compatibility:** GitHub tokens saved before encryption was introduced are stored as plain text. All read paths use `safeDecrypt(token) || token` — if decryption fails the raw value is used as fallback. Tokens are re-encrypted on next save.

### GitHub Token Handling
GitHub tokens are never stored or sent client-side. The client form shows a masked placeholder (`••••••••••••••••`) when a token exists; the actual value is never returned to the browser. On save, the token is only sent to `POST /api/clients/[id]/github` if the user edited the field (`githubTokenDirty === true`), where it is encrypted server-side before writing to Supabase.

### CRON_SECRET
`/api/schedule/check` fails closed — if `CRON_SECRET` is not set in the environment, all requests are rejected with 401 unless they carry Vercel's own cron signature header. This prevents the cron endpoint from being triggered by unauthenticated callers.

### Workspace Isolation
User-triggered API calls validate workspace ownership before acting on resources. See the Multi-Tenancy section for the pattern. Cron calls bypass the user check (no `Authorization` header) and are validated separately via `CRON_SECRET`.

### OAuth Empty Property Guard
If a Google account has no accessible GSC properties, the OAuth callback redirects to `?gsc=error&message=no_properties` instead of saving an empty `google_connections` row.

---

## Known Limitations

- `run-task` and `schedule/run` routes still use the env var API key — workspace key routing is only implemented in the chat route
- Agent marketplace is display-only — Leo, Iris, Scout, Ellie show "Coming soon"; Theo is seeded but not yet in the marketplace UI
- `content_history.embedding` column exists but semantic search is not implemented
- Webflow publish returns 501 Not Implemented
- `RESEND_API_KEY` and verified sender domain not yet set — notification emails will fail silently until configured
- `ENCRYPTION_KEY` should be verified as exactly 32 bytes (base64-decoded) before adding a second Google OAuth connection
- Scheduled jobs `content` type still calls `POST /api/schedule/run` (legacy client_schedules); `write_content` / Theo publish loop not yet wired into the job runner
