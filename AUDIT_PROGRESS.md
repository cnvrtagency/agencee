# Agencee Stabilisation Audit Progress

Started: 2026-06-11T21:42:17Z
Repo: `/Users/danlyons/Work/agencee`
Branch: `main`

## Session Ground Rules

- `git pull origin main` completed before code changes. Result: already up to date.
- `ARCHITECTURE.md` read in full before code changes.
- Supabase MCP is unavailable for privileged operations because the MCP server has no `SUPABASE_ACCESS_TOKEN`.
- Local `.env.local` has Supabase URL, anon key, and `SUPABASE_SERVICE_KEY`; local read-only Supabase connection verified.
- Use local scripts/CLI for read-only database inspection where possible. Mark anything requiring dashboard/MCP privileges as MANUAL.

## Phase Status

| Phase | Status | Notes |
|---|---|---|
| Phase 1: Ground-truth map | IN PROGRESS | Architecture doc read. Schema/RLS/index dump and route/page inventories next. |
| Phase 2: Contract verification | PARTIAL | High-risk API contracts reviewed and patched. Full generated inventory still pending. |
| Phase 2.5: Runtime/platform failure modes | PARTIAL | Cron early-return, long route maxDuration, stale-running queue/job/automation handling, and missing env failures patched. |
| Phase 2.6: System edges | PARTIAL | Queue schema/runtime mismatch patched and verified live. Storage buckets checked. Remaining: middleware/proxy, payload limits, data-integrity constraints. |
| Phase 2.7: Security and cost protection | PARTIAL | First pass complete for open service-role routes, expensive endpoints, budget checks, and rate limits. OAuth signed-state still open. |
| Phase 2.8: Performance, scale, lifecycle | NOT STARTED | Pending indexes and hot query audit. |
| Phase 2.9: Product flows | PARTIAL | `/usage` added. Agent nav live rows checked. Theo upload icon mismatch fixed. Remaining: deeper authenticated smoke flows. |
| Phase 3: Fixes | PARTIAL | P0/P1 API auth, cron, queue, usage tracking, budget/rate guard fixes implemented. |
| Phase 4: Usage page | DONE | `/usage` route built and linked from Sidebar/Settings. |
| Phase 5: ARCHITECTURE.md update | DONE | Architecture updated with auth model, usage page, queue migration, findings, env notes, and changelog. |

## Live Findings

| ID | Severity | Status | Finding | Evidence | Next action |
|---|---|---|---|---|---|
| F-001 | High | IN PROGRESS | Supabase MCP cannot inspect schema or apply migrations without `SUPABASE_ACCESS_TOKEN`. | MCP returned Unauthorized for `get_project` and `list_tables`. | Use local env/CLI for read-only inspection; mark MCP-only actions MANUAL. |
| F-002 | Medium | IN PROGRESS | Supabase CLI cannot dump schema because Docker is not running, and `psql` is not installed. | `supabase db dump --linked` failed on Docker daemon; `psql` command missing. | Use Node/temporary driver or PostgREST fallback for live inspection. |
| F-003 | Critical | FIXED | Most `/api/*` routes used the service-role key with no user or internal auth check. | Static inventory showed unauthenticated service-role routes including `chat`, `run-task`, `crawl`, `generate-image`, `calendar/generate-plan`, `connections/*`, `github`, `reports/generate`, `briefing-items`, `agent-activity`, `knowledge`, and scheduler helpers. | Added bearer-token API auth wrapper, shared server guards, ownership checks, and `CRON_SECRET` internal auth. |
| F-004 | Critical | FIXED | `/api/schedule/check` returned early when no `client_schedules` were due, skipping GSC sync, scheduled jobs, automations, reports, knowledge digest, and notifications. | Route returned `{ triggered: 0 }` before the rest of the cron pipeline. | Removed early return and awaited authenticated subrequests. |
| F-005 | High | FIXED | Browser-side token tracking called stale `increment_token_usage` after `/api/chat` had already logged/incremented usage, risking double counting or RPC errors. | `agents/[id]/page.tsx` called `supabase.rpc('increment_token_usage')`; `/api/chat` uses `increment_tokens`. | Removed browser-side increment and centralised accounting in server routes. |
| F-006 | High | FIXED | Queue worker used the first workspace API key and did not enforce budget before Anthropic calls. | `/api/run-task` selected `workspace_settings.limit(1)` and only fire-and-forget logged tokens. | Uses owning client/user settings, budget guard, awaited token logging, and internal/user auth. |
| F-007 | High | FIXED | Automation runner loaded all clients and all active GSC connections regardless of workspace. | `/api/intelligence/run-automation` queried `client_profiles` globally and `google_connections` globally in `gsc_review`. | Scoped clients and connections through the owning agent/workspace. |
| F-008 | High | BLOCKED | Full live schema/RLS/index dump cannot be produced from this environment yet. | MCP lacks token; Supabase CLI needs Docker; pooler URL has no DB password; PostgREST does not expose catalog views. | MANUAL SQL required unless a DB password or `SUPABASE_ACCESS_TOKEN` is provided. |
| F-009 | Medium | OPEN | Google OAuth start/callback still uses plain `state=clientId`; fixing fully requires a signed-state or server-side OAuth session flow. | Browser navigation cannot carry the Supabase bearer token, and the callback is reached from Google without app auth headers. | Document as security follow-up; do not break current connect flow during this pass. |
| F-010 | Medium | ACCEPTED | `npm audit` reports two moderate vulnerabilities via Next's bundled PostCSS; npm's suggested fix is a major downgrade to `next@9.3.3`. | `npm audit --audit-level=moderate --json`. | Do not apply downgrade; monitor Next upgrade path. |
| F-011 | High | VERIFIED | Live `content_queue` schema was missing runtime columns used or expected by queue code. | Probes showed missing `started_at`, `completed_at`, `calendar_id`, `notes`, and `updated_at`; post-apply read probe passes for all runtime columns plus `content_outputs.queue_item_id`. | Closed. Migration applied manually in Supabase and verified from app service client. |
| F-012 | Medium | FIXED | Cost estimates were split across hardcoded `$4/M` constants and Sonnet-only session math. | Dashboard/activity/sidebar/agent pages each carried local estimates. | Added `src/lib/pricing.ts` and replaced visible aggregate estimates with shared model pricing helpers. |
| F-013 | Medium | FIXED | Operators had no dedicated current usage page. | `/settings` had only a small budget bar; sidebar had today's spend only. | Added `/usage` with totals, budget state, activity breakdown, route protection status, and recent usage. |
| F-014 | Low | FIXED | Theo DB nav uses `upload` icon but Sidebar had no `upload` icon mapping. | Live agents probe showed Theo nav item `{ icon: "upload" }`; `Sidebar` ICONS map lacked it. | Added `upload` icon mapping in `Sidebar`. |
| F-015 | Medium | OPEN | Repo lint is not a reliable green gate yet due broad pre-existing strict lint debt. | `npm run lint` reports 421 errors and 48 warnings, heavily `no-explicit-any`, unused variables, and hook ordering in older files. | Treat `npx tsc --noEmit` as the current compile gate; fix lint in a dedicated pass. |
| F-016 | High | FIXED | Some AI-cost routes were rate-limited but not fully budget-gated or usage-accounted. | Static route matrix flagged `crawl`, `generate-image`, and `knowledge-digest`; crawl Haiku calls did not record actual usage. | Added budget gates for crawl, image generation, and user-triggered knowledge digest. Crawl now records actual Haiku usage for content and competitor summaries. Static AI matrix now reports no Anthropic/Gemini routes missing budget gates, and no Anthropic routes missing usage recording. |

## Verification

| Check | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` | PASS | Run after security/cost changes and again after `/usage`, queue schema fix, and sidebar usage filter. |
| `npm run build` | PASS | Next 16 production build completed; all 53 app routes generated/validated. |
| Browser smoke `/usage` | PASS | Local dev server returned `GET /usage 200`; in-app browser saw the Usage page and no console errors. |
| `npm run lint` | FAIL | Existing strict lint debt remains repo-wide. Not a clean regression signal for this pass. |
| `npm audit --audit-level=moderate --json` | ACCEPTED | Two moderate advisories via Next bundled PostCSS; suggested npm fix is an unsafe major downgrade. |
| Supabase live data probes | PARTIAL PASS | Agents, automations, queue count, calendar orphan count, GSC connections, and storage buckets checked. Full schema/RLS/index blocked. |
| Queue migration live verification | PASS | `content_queue` runtime columns and `content_outputs.queue_item_id` are readable from the app service client after manual SQL apply. |
| AI cost-protection matrix | PASS | Static scan found no Anthropic/Gemini routes without a budget gate and no Anthropic routes without usage recording after F-016 patch. |

## Manual Checks To Carry Forward

- Vercel env vars: `GEMINI_API_KEY`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `RESEND_API_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_KEY`.
- GSC reconnect for expired Hear Better OAuth tokens: client Connections tab -> disconnect -> reconnect.
- Verify Railway worker deployment and env, especially `AGENCEE_URL=https://agencee.vercel.app`.
- Verify Supabase Storage `blog-images` bucket exists and has public read.
- Run the Phase 1 schema/RLS SQL manually in Supabase SQL Editor, or provide `SUPABASE_ACCESS_TOKEN` / DB password for automated dump.

## Remaining Audit Queue

1. Complete the generated route/page inventory and auth matrix now that the P0 route hardening pass is in. Current static scan leaves Google OAuth start/callback as the main unauthenticated-by-design exception and `/api/schedule/check` as custom cron-secret auth.
2. Finish runtime/platform failure-mode audit: middleware-to-proxy migration, payload/body limits, route `maxDuration`, cron idempotency, and worker handoff.
3. Finish system-edge audit: multi-tenant data integrity, RLS policy review, storage policy review, missing FK/check constraints, queue/calendar/output consistency.
4. Fix or intentionally backlog Google OAuth signed state.
5. Do a performance/index pass for hot tables: `agent_activity`, `content_queue`, `briefing_items`, `search_performance`, `keyword_banks`, `content_outputs`.
6. Decide whether to tackle repo-wide lint debt as a separate cleanup pass; current compile/build gate is green.

## Checkpoints

- 2026-06-11T21:42:17Z: Progress file created after repo sync and architecture read.
- 2026-06-11T22:06:00Z: Security/cost first pass complete. Added client auth fetch wrapper, shared server auth/rate/budget helpers, closed most open service-role routes, fixed cron early return, and verified `npx tsc --noEmit` passes.
- 2026-06-11T22:10:54Z: Usage page linked, queue runtime migration added, Theo upload icon mapping fixed, architecture/progress docs updated, and validation status recorded.
- 2026-06-11T22:14:56Z: Production build passed after checkpoint commit/push.
- 2026-06-11T22:19:57Z: User applied queue runtime SQL in Supabase; app service-client probe verified `content_queue` runtime columns and `content_outputs.queue_item_id`.
- 2026-06-11T22:23:41Z: AI cost matrix tightened: crawl/image/digest budget gates patched, crawl Haiku usage logging added, and static scan now shows no Anthropic/Gemini route missing budget protection.
