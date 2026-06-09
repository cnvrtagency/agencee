# Agencee — Technical Documentation

Internal agency operations dashboard for CNVRT. Used exclusively by the agency owner to manage AI agents, brief content tasks, and review agent-produced drafts.

---

## Overview

The core workflow:
1. Dan briefs Ada (SEO agent) in chat
2. Ada plans content tasks and saves them as planned tasks via tool use
3. Dan schedules them from the Queue page
4. A separate Node.js worker picks up queued tasks, runs them against the Claude API, and saves draft content
5. Dan reviews and approves outputs in the dashboard

---

## Tech Stack

**Frontend / UI**
- Next.js (App Router), TypeScript
- Tailwind v4 — CSS-first, configured via `@theme` in `globals.css`. No `tailwind.config.js`.
- All component styling uses inline CSS objects (not Tailwind utility classes)
- Google Fonts loaded via `<link>` in `layout.tsx`: Instrument Serif, JetBrains Mono

**Backend / Data**
- Supabase (PostgreSQL + pgvector)
- Project URL: `https://qzyksnszutnorppfqchz.supabase.co`
- RLS disabled on all tables
- Anon key used client-side; service role key used in API routes

**AI**
- Anthropic API
- `claude-opus-4-8` for scheduled tasks (worker)
- `claude-sonnet-4-6` for chat (UI)
- Prompt caching enabled (`anthropic-beta: prompt-caching-2024-07-31`)
- Tool use for agent task planning and file reading

**Worker**
- Node.js with ES modules (`"type": "module"`)
- Packages: `@anthropic-ai/sdk`, `@supabase/supabase-js`, `node-cron`, `dotenv`
- Deployed on Railway (always-on, not serverless)
- Checks queue every 5 minutes via cron

**Hosting**
- UI: running locally on `http://localhost:3000`
- Worker: deployed on Railway, auto-deploys from GitHub push

---

## Environment Variables

**UI** (`~/Desktop/agencee/.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL=https://qzyksnszutnorppfqchz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
ANTHROPIC_API_KEY=
```

**Worker** (`~/Desktop/seo-agent-worker/.env`)
```
SUPABASE_URL=https://qzyksnszutnorppfqchz.supabase.co
SUPABASE_SERVICE_KEY=
ANTHROPIC_API_KEY=
```

---

## Directory Structure

```
src/
  app/
    globals.css              Tailwind v4 @theme tokens, base styles
    layout.tsx               Root layout, sidebar, font imports
    page.tsx                 Dashboard (stats, pending review, queue activity)
    agents/
      page.tsx               Agent cards grid
      [id]/
        page.tsx             Agent detail: Chat tab + Settings tab
    clients/
      page.tsx               Clients list + add client modal
      [id]/
        page.tsx             Client detail: Profile / Keywords / Site pages / Codebase tabs
    queue/
      page.tsx               Queue table + schedule task modal with planned tasks
    outputs/
      page.tsx               Outputs list (pending review / approved)
      [id]/
        page.tsx             Output detail: full draft, approve + log to history, publish to repo
    api/
      chat/
        route.ts             Anthropic API proxy with prompt caching
      crawl/
        route.ts             Site crawler: fetches pages, extracts content and summaries
      github/
        route.ts             GitHub API: POST syncs file tree, GET reads files, PUT commits files
  components/
    Sidebar.tsx              Navigation sidebar with active state
    StatusBadge.tsx          Coloured status indicator
  lib/
    supabase.ts              Supabase client (anon key)
    types.ts                 TypeScript types for all DB entities
docs/
  AGENCEE.md                 This file
```

---

## Pages

### Dashboard (`/`)
Stats cards (clients, queued, running, needs review), pending review panel, queue activity panel.

### Agents (`/agents`)
Grid of agent cards. Each card links to the agent detail page.

### Agent detail (`/agents/[id]`)
Two tabs:
- **Chat** — full conversation UI with conversation history sidebar, planned tasks sidebar, streaming-style message display. Sends messages to `/api/chat`. Handles `tool_use` stop reason by executing the tool client-side and continuing the conversation.
- **Settings** — editable fields for all agent personality/identity columns. Saves to `agents` table.

### Clients (`/clients`)
List of clients. Add client modal (name, website, industry fields).

### Client detail (`/clients/[id]`)
Four tabs:
- **Profile** — editable fields for all `client_profiles` columns. Triggers site crawl and GitHub sync.
- **Keywords** — keyword bank table with add keyword form.
- **Site pages** — table of crawled pages from `site_pages`.
- **Codebase** — displays synced file tree from `client_profiles.file_tree`.

### Queue (`/queue`)
Table of all `content_queue` items with status badges. Schedule task modal pre-fills from planned tasks. Keyword dropdown pulls from the selected client's `keyword_banks`.

### Outputs (`/outputs`)
List of content outputs, split into pending review and approved. Links to output detail.

### Output detail (`/outputs/[id]`)
Full draft content, metadata (client, keyword, word count, meta description), SEO notes panel. Actions:
- **Copy content** — copies markdown to clipboard
- **Approve and log** — marks approved, saves summary + optional URL to `content_history`
- **Publish to repo** — commits the draft as a TypeScript content entry to the client's GitHub repo (see below)

---

## API Routes

### `POST /api/chat`
Proxies to Anthropic Messages API. Wraps the system prompt in a `cache_control: { type: 'ephemeral' }` block. Returns raw Anthropic response. Handles are done client-side in the agent page.

### `POST /api/crawl`
Crawls a client's website. Fetches pages, extracts URL, title, H1, meta description, body text (up to 3000 chars), and auto-generates a content summary via Claude. Saves to `site_pages`, updates `client_profiles.last_crawled_at`.

### `GET /api/github?client_id=&path=`
Reads a specific file from the client's GitHub repo. Used by Ada's `read_file` tool. Returns `{ success, path, content }`.

### `POST /api/github`
Syncs the repo file tree. Fetches the full tree via GitHub Git Trees API, filters to relevant files (`.ts`, `.tsx`, `.mdx`, `.md`, config files, content/app directories), formats it, and saves to `client_profiles.file_tree`.

### `PUT /api/github`
Commits a new file to the client's GitHub repo. Used by the publish flow on output detail. Accepts `{ client_id, path, content, message }`. Creates or updates the file via GitHub Contents API. Returns `{ success, url, sha }`.

---

## Database Schema

### `client_profiles`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| slug | text unique | |
| industry | text | |
| website | text | |
| description | text | What they do and who they serve |
| icp | text | Ideal customer profile |
| usp | text | Unique selling proposition |
| competitors | text[] | |
| brand_voice | text | Tone, style, what to avoid |
| content_goals | text | |
| top_performing_content | text | |
| last_crawled_at | timestamptz | |
| github_repo | text | Full GitHub repo URL |
| github_branch | text | Default: main |
| github_token | text | Personal access token |
| github_synced_at | timestamptz | |
| file_tree | text | Formatted file tree from last sync |
| created_at, updated_at | timestamptz | |

### `keyword_banks`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK | |
| keyword | text | |
| cluster | text | Topic cluster |
| intent | text | informational/navigational/commercial/transactional |
| funnel_stage | text | tofu/mofu/bofu |
| monthly_volume | integer | |
| difficulty | integer | 0-100 |
| current_position | integer | |
| content_targeting_this | text | URL of existing content for this term |
| priority | integer | 1 (highest) to 10 |
| created_at | timestamptz | |

### `content_queue`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK | |
| agent_type | text | e.g. 'seo' |
| content_type | text | blog_post/pillar_page/category_page/local_seo |
| primary_keyword | text | |
| supporting_keywords | text[] | |
| title_brief | text | |
| word_count | integer | |
| scheduled_for | timestamptz | |
| status | text | queued/running/done/failed/review |
| output_id | uuid | Set once agent completes |
| error | text | |
| created_at | timestamptz | |

### `content_outputs`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK | |
| queue_item_id | uuid FK | |
| agent_type | text | |
| title | text | Proposed title tag |
| content | text | Full draft in markdown |
| primary_keyword | text | |
| meta_description | text | |
| word_count | integer | |
| approved | boolean | Default false |
| published_url | text | Set after publishing |
| notes | text | Structured SEO metadata (snippet, schema, trust signals, internal links) |
| created_at | timestamptz | |

### `content_history`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK | |
| title | text | |
| url | text | |
| primary_keyword | text | |
| summary | text | Angle this piece took |
| published_at | timestamptz | |
| performance_notes | text | |
| embedding | vector(1536) | For future semantic search |
| created_at | timestamptz | |

### `agents`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | e.g. 'Ada' |
| role | text | e.g. 'SEO Specialist' |
| slug | text unique | |
| avatar_initials | text | |
| description | text | One-line summary |
| instructions | text | Additional instructions |
| backstory | text | |
| expertise | text | |
| personality | text | |
| communication_style | text | |
| working_style | text | |
| boundaries | text | What she never does |
| agent_type | text | e.g. 'seo' |
| active | boolean | |
| created_at, updated_at | timestamptz | |

### `conversations`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| agent_id | uuid FK | |
| title | text | Auto-set from first message |
| created_at, updated_at | timestamptz | |

### `messages`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| conversation_id | uuid FK | |
| role | text | user/assistant |
| content | text | |
| created_at | timestamptz | |

### `planned_tasks`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| agent_id | uuid FK | |
| client_id | uuid FK | |
| conversation_id | uuid FK | |
| status | text | draft/ready/scheduled |
| content_type | text | |
| primary_keyword | text | |
| supporting_keywords | text[] | |
| title_brief | text | |
| word_count | integer | |
| internal_links | text | |
| notes | text | |
| created_at, updated_at | timestamptz | |

### `site_pages`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK | |
| url | text | |
| title | text | |
| h1 | text | |
| meta_description | text | |
| word_count | integer | |
| internal_links | text[] | |
| content | text | Extracted page text (up to 3000 chars) |
| content_summary | text | Auto-generated summary |
| crawled_at | timestamptz | |

---

## Agent System

### System Prompt Assembly
Built dynamically on every message from:
1. Agent identity (name, role)
2. Backstory, expertise, personality, communication style, working style, boundaries
3. Additional instructions
4. Planned tasks capability description (explains `save_planned_task` and `update_planned_task`)
5. All client profiles (description, ICP, USP, brand voice, goals, competitors)
6. Live site inventory per client (URLs + content summaries from `site_pages`)
7. Codebase file tree per client (from `client_profiles.file_tree`)
8. Existing planned tasks (so Ada can reference and update by ID)

The system prompt is cached via Anthropic prompt caching.

### Tools Available to Agents
- `save_planned_task` — inserts a row into `planned_tasks`
- `update_planned_task` — updates an existing planned task by ID
- `read_file` — reads a specific file from the client's GitHub repo via `GET /api/github`

### Tool Execution
The chat API route returns the raw Anthropic response. The agent page client-side detects `stop_reason === 'tool_use'`, executes the tool (Supabase insert/update or GitHub fetch), then makes a second call to `/api/chat` with the tool result appended and shows the final reply.

---

## Worker Flow

1. Cron fires every 5 minutes
2. Picks up the oldest `queued` task where `scheduled_for <= now()`
3. Marks it `running`
4. Fetches client context: keyword bank, content history, existing content for that keyword, recent approved outputs
5. Builds a structured system prompt with SEO rules
6. Calls Claude Opus 4.8 with prompt caching on the system prompt
7. Parses structured output (TITLE_TAG, META_DESCRIPTION, H1, SNIPPET_BLOCK, SCHEMA_NOTES, TRUST_SIGNALS_USED, INTERNAL_LINKS, CONTENT)
8. Saves to `content_outputs`, updates queue item to `review`

---

## Publish Flow

When "Publish to repo" is clicked on an output detail page:
1. Calls `PUT /api/github` with the client ID, target file path, MDX/TS content, and commit message
2. The route reads `github_repo`, `github_branch`, `github_token` from `client_profiles`
3. Commits the file via GitHub Contents API (`PUT /repos/{owner}/{repo}/contents/{path}`)
4. On success, updates `content_outputs.published_url` with the GitHub file URL
5. UI shows the committed file URL

**Hear Better target path:** `next-public/content/blog.ts` — blog posts are TypeScript content objects, not MDX files. New posts are appended to the exported array in that file.

---

## Current Client: Hear Better

- Client ID: `d46432ec-520c-4b16-8752-9b3f3b908f79`
- Website: `https://hearbetternow.co.uk`
- GitHub repo: `https://github.com/cnvrtagency/wireframe-whisperer-89`
- Branch: `nextjs-public-site-spike`
- 18 pages crawled, file tree synced, 20 keywords seeded

Blog content lives in `next-public/content/blog.ts` and `next-public/content/blogContent.tsx` as TypeScript content objects (not MDX).

---

## Current Agent: Ada

- Role: SEO Specialist
- Agent type: `seo`
- All personality fields populated
- Tools: `save_planned_task`, `update_planned_task`, `read_file`

---

## Design Tokens

| Token | Value |
|---|---|
| Background | `#0D0F14` |
| Surface | `#141720` |
| Surface-2 | `#1C1F2A` |
| Border | `#252836` |
| Primary text | `#E2E4EE` |
| Secondary text | `#8B91A8` |
| Accent | `#6366F1` |
| Green / approved | `#34D399` |
| Amber / running | `#F59E0B` |
| Red / failed | `#F87171` |
| Display font | Instrument Serif (wordmark only) |
| UI font | Space Grotesk / Inter |
| Mono font | JetBrains Mono |

---

## Known Gaps

- No auth — internal tool only, all Supabase RLS disabled
- Worker only handles `agent_type: seo`; other agent types not yet implemented
- `content_history.embedding` column exists but semantic search is not implemented
- UI not yet deployed (local only)
- Hear Better blog content is actually TypeScript content objects in `next-public/content/blog.ts`, not markdown files. The publish flow currently commits markdown with frontmatter; the file path should be adjusted per repo structure.
