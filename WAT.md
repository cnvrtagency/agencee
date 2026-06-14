# WAT — Pre-Deploy Verification

WAT means "Works As Tested". Before deploying, prove the changed path works locally or in an explicit staging/preview context. This file is the deploy gate for Agencee until CI enforces the same checks.

## Rule Zero

Do not deploy because the code "looks right". Deploy when the relevant checks below have passed, or when a failure is explicitly accepted and written down in the deploy notes.

## Required Every Time

Run from the repo root:

```bash
npm run wat
```

`npm run wat` currently runs:

```bash
npm run typecheck
npm run build
```

Current caveat: `npm run lint` is not a reliable blocking gate yet because the repo has broad pre-existing strict lint debt. Run it when touching lint-sensitive/shared code, but do not treat old unrelated findings as a deploy blocker. New or nearby lint errors should be fixed.

## Change-Specific Checks

Use the smallest set that proves the changed behaviour.

| Area touched | Minimum proof |
|---|---|
| Agent chat/tool loop | Start dev server, send one real chat turn for the affected agent, verify tool calls complete, no empty assistant bubbles, task log looks sane, usage records if an AI route ran. |
| Ada content writing | Generate or save a draft, verify `content_outputs` row appears, review URL works, images are attached or intentionally skipped, internal-link suggestion path does not break the final reply. |
| Publishing | Publish an approved test output through the affected connection, verify committed paths, rewritten image URLs, `published_url`, `platform_output`, and idempotent retry. |
| API route auth | Test unauthenticated, wrong-workspace if practical, and valid authenticated/internal calls. Service-role routes must still prove user or internal ownership before data access. |
| Cron/jobs/automations | Run the route manually with the right internal auth, verify status transitions, `job_runs`/`agent_activity`, stale-running protection, and useful error summaries. |
| Database migration | Apply locally or manually in Supabase, then verify columns/indexes/policies with a read probe. Record whether remote SQL was applied. |
| GSC/OAuth | Verify redirect URI, signed state/session handling, reconnect-needed status, and one sync or properties fetch. |
| Image generation | Verify workspace/env Gemini key resolution and one small image smoke if models/config changed. |
| UI pages/components | Browser smoke the page at desktop and mobile-ish widths. Check console, loading/empty/error states, text overflow, and destructive action confirmations. |
| Usage/cost controls | Confirm budget gate, rate limit, and token/cost accounting on any new AI route. |
| Notifications | Verify preference gating, Slack/email branch if configured, and `notification_log` success/error behaviour. |

## Browser Smoke List

For broad UI or layout changes, open the local app and check:

- `/`
- `/agents`
- `/agents/[id]`
- `/clients`
- `/clients/[id]`
- `/outputs`
- `/outputs/[id]`
- `/usage`
- `/settings`

Use the in-app browser when available. Watch for console errors and broken loading states.

## Pre-Deploy Notes Template

Paste this into the final handoff or PR before deploying:

```text
WAT
- Typecheck: pass/fail/not run
- Build: pass/fail/not run
- Lint: pass/fail/not run/accepted existing debt
- Browser smoke: routes checked
- Data/API smoke: what was exercised
- Migrations/env/manual steps: done or still required
- Known accepted risks:
```

## CI Target

CI now runs `.github/workflows/wat.yml` on pull requests and pushes to `main`:

1. `npm ci`
2. `npm run typecheck`
3. `npm run build`

Next checks to add:

1. A lightweight route/auth smoke suite for high-risk API routes
2. Playwright smoke for the core app pages

After lint debt is reduced, promote `npm run lint` to a required check.
