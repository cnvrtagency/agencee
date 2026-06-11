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
| Phase 1: Ground-truth map | DONE | Architecture read. Route/page inventory captured in `AUDIT_ROUTE_MATRIX.md`. Full schema/RLS/index dump remains blocked without Supabase access token or DB password. |
| Phase 2: Contract verification | DONE | High-risk API contracts reviewed and patched. Auth matrix captured in `AUDIT_ROUTE_MATRIX.md`. |
| Phase 2.5: Runtime/platform failure modes | DONE | Cron early-return, long route maxDuration, stale-running queue/job/automation handling, missing env failures, proxy migration, and high-risk payload limits patched. |
| Phase 2.6: System edges | DONE | Queue schema/runtime mismatch patched and verified live. Storage buckets checked. Data-integrity/index/storage SQL prepared in `20260611_audit_hardening.sql`. |
| Phase 2.7: Security and cost protection | DONE | Service-role auth pass, budget/rate guards, OAuth signed-state, server-side OAuth session, and token-in-URL removal patched. |
| Phase 2.8: Performance, scale, lifecycle | DONE | Hot-path index SQL prepared for manual apply in `20260611_audit_hardening.sql`. |
| Phase 2.9: Product flows | DONE | `/usage` added, agent nav live rows checked, Theo upload icon fixed, image generation route fixed and SDK-smoked. |
| Phase 3: Fixes | DONE | P0/P1 API auth, cron, queue, usage tracking, budget/rate guard, OAuth, image generation, proxy, and payload limit fixes implemented. |
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
| F-009 | Medium | FIXED | Google OAuth start/callback used plain `state=clientId` and the multi-property flow pushed tokens through the browser URL. | Browser navigation could not carry the Supabase bearer token, and callback reached the app without auth headers. | OAuth start now uses authenticated fetch, signed expiring state, user/client validation, and server-side `google_oauth_sessions`. Multi-property setup passes only `session_id` in the URL. Requires SQL `20260611_audit_hardening.sql`. |
| F-010 | Medium | ACCEPTED | `npm audit` reports two moderate vulnerabilities via Next's bundled PostCSS; npm's suggested fix is a major downgrade to `next@9.3.3`. | `npm audit --audit-level=moderate --json`. | Do not apply downgrade; monitor Next upgrade path. |
| F-011 | High | VERIFIED | Live `content_queue` schema was missing runtime columns used or expected by queue code. | Probes showed missing `started_at`, `completed_at`, `calendar_id`, `notes`, and `updated_at`; post-apply read probe passes for all runtime columns plus `content_outputs.queue_item_id`. | Closed. Migration applied manually in Supabase and verified from app service client. |
| F-012 | Medium | FIXED | Cost estimates were split across hardcoded `$4/M` constants and Sonnet-only session math. | Dashboard/activity/sidebar/agent pages each carried local estimates. | Added `src/lib/pricing.ts` and replaced visible aggregate estimates with shared model pricing helpers. |
| F-013 | Medium | FIXED | Operators had no dedicated current usage page. | `/settings` had only a small budget bar; sidebar had today's spend only. | Added `/usage` with totals, budget state, activity breakdown, route protection status, and recent usage. |
| F-014 | Low | FIXED | Theo DB nav uses `upload` icon but Sidebar had no `upload` icon mapping. | Live agents probe showed Theo nav item `{ icon: "upload" }`; `Sidebar` ICONS map lacked it. | Added `upload` icon mapping in `Sidebar`. |
| F-015 | Medium | OPEN | Repo lint is not a reliable green gate yet due broad pre-existing strict lint debt. | `npm run lint` reports 421 errors and 48 warnings, heavily `no-explicit-any`, unused variables, and hook ordering in older files. | Treat `npx tsc --noEmit` as the current compile gate; fix lint in a dedicated pass. |
| F-016 | High | FIXED | Some AI-cost routes were rate-limited but not fully budget-gated or usage-accounted. | Static route matrix flagged `crawl`, `generate-image`, and `knowledge-digest`; crawl Haiku calls did not record actual usage. | Added budget gates for crawl, image generation, and user-triggered knowledge digest. Crawl now records actual Haiku usage for content and competitor summaries. Static AI matrix now reports no Anthropic/Gemini routes missing budget gates, and no Anthropic routes missing usage recording. |
| F-017 | High | FIXED | Image generation used stale Gemini image model IDs/API shape. | Direct smoke showed REST rejected old config fields; official SDK with `gemini-3.1-flash-image` returned a JPEG. | `/api/generate-image` now uses `@google/genai`, current Nano Banana model IDs, model-aware image size/aspect config, and fallback models. SDK smoke passes. |
| F-018 | Medium | FIXED | Next 16 deprecated `middleware.ts` convention. | `npm run build` warned to use `proxy`. | Moved `src/middleware.ts` to `src/proxy.ts` and exported `proxy`; build warning is gone. |
| F-019 | Medium | FIXED | Expensive JSON routes had no explicit request body caps. | Static route inventory showed unbounded `req.json()` on AI routes. | Added `readJsonWithLimit` and wired it into chat, image generation, crawl, calendar plan generation, reports, and run-task. |
| F-020 | Medium | READY_FOR_SQL | Hot table indexes, queue/calendar/output constraints, storage public-read policy, and OAuth session table need remote SQL apply. | Code migration added at `supabase/migrations/20260611_audit_hardening.sql`. | Apply the SQL block printed in the assistant response. |

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
| Gemini SDK image smoke | PASS | `@google/genai` generated a JPEG with `gemini-3.1-flash-image` using 512px test config. |
| Route/page inventory | PASS | `AUDIT_ROUTE_MATRIX.md` records 40 API routes and 27 app pages. |

## Manual Checks To Carry Forward

- Vercel env vars: `GEMINI_API_KEY`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `RESEND_API_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_KEY`.
- GSC reconnect for expired Hear Better OAuth tokens: client Connections tab -> disconnect -> reconnect.
- Verify Railway worker deployment and env, especially `AGENCEE_URL=https://agencee.vercel.app`.
- Verify Supabase Storage `blog-images` bucket exists and has public read.
- Run the Phase 1 schema/RLS SQL manually in Supabase SQL Editor, or provide `SUPABASE_ACCESS_TOKEN` / DB password for automated dump.
- Apply `supabase/migrations/20260611_audit_hardening.sql`.

## Remaining Audit Queue

1. Apply `20260611_audit_hardening.sql` remotely and run a live probe against `google_oauth_sessions`.
2. Verify GSC OAuth end-to-end in browser after SQL apply.
3. Verify one real Ada image generation call after deploy.
4. Decide whether repo-wide lint debt should be a separate cleanup sprint; compile/build gate is green.

## Checkpoints

- 2026-06-11T21:42:17Z: Progress file created after repo sync and architecture read.
- 2026-06-11T22:06:00Z: Security/cost first pass complete. Added client auth fetch wrapper, shared server auth/rate/budget helpers, closed most open service-role routes, fixed cron early return, and verified `npx tsc --noEmit` passes.
- 2026-06-11T22:10:54Z: Usage page linked, queue runtime migration added, Theo upload icon mapping fixed, architecture/progress docs updated, and validation status recorded.
- 2026-06-11T22:14:56Z: Production build passed after checkpoint commit/push.
- 2026-06-11T22:19:57Z: User applied queue runtime SQL in Supabase; app service-client probe verified `content_queue` runtime columns and `content_outputs.queue_item_id`.
- 2026-06-11T22:23:41Z: AI cost matrix tightened: crawl/image/digest budget gates patched, crawl Haiku usage logging added, and static scan now shows no Anthropic/Gemini route missing budget protection.
- 2026-06-11T22:38:30Z: Image generation fixed with official Google SDK/current Nano Banana models; OAuth signed state/server-side session patched; middleware migrated to proxy; high-risk payload limits added; route/page matrix added; audit hardening SQL prepared.
