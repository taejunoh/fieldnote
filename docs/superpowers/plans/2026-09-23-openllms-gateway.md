# openllms Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the sports desk's persistent conversation and verified web analysis through a self-hosted openllms Codex OAuth gateway without automatic paid API fallback.

**Architecture:** Pin upstream openllms at `76945701e6822512ca7370d5583db6822e16eb83` and carry a small reproducible patch set. Next.js enqueues work in Supabase; a separate Node worker claims and executes jobs against the gateway, validates its terminal status and cited sources, and finalizes one assistant message per request.

**Tech Stack:** Next.js 15, TypeScript, Supabase Postgres, Go gateway built with Docker, Vitest, gateway Go tests.

---

### Task 1: Reproducible gateway build and compatibility patch

**Files:** Create `gateway/Dockerfile`, `gateway/patches/0001-sports-desk-compat.patch`, `gateway/README.md`; modify only a temporary pinned clone to generate the patch.

- [ ] Add a gateway fixture test showing that a Chat Completions request with `reasoning_effort: "xhigh"` produces upstream `reasoning: {"effort":"xhigh"}` and keeps live `web_search` enabled. Run the targeted Go test in Docker and observe failure before patching.
- [ ] Patch the bridge to validate `medium`/`xhigh` and forward effort. Preserve source URLs and `url_citation` annotations in `llms` metadata. Expose upstream response ID and terminal status in aggregate and stream results.
- [ ] Add fixtures for `response.completed`, `response.incomplete`, `response.failed`, and EOF without a terminal event. Only explicit completed may produce success; missing sources must remain unverified.
- [ ] Generate the patch with `git diff --binary`, build the pinned fork from the Dockerfile, and run `go test ./internal/proxy/...` inside Docker. Do not start OAuth or use credentials.

### Task 2: Durable job state and fencing

**Files:** Create `supabase/migrations/202609230002_openllms_worker.sql`; add SQL/TS fixture tests under `src/lib/analysis/` as needed.

- [ ] Add `provider`, `model`, `effort`, `current_attempt_id`, lease owner/expiry/heartbeat and provider metadata to `analysis_jobs`. Add `analysis_attempts` with attempt ID, status, timestamps, error, usage, source metadata, and a uniqueness key for each job attempt.
- [ ] Add a service-role-only atomic claim RPC: select queued jobs with `FOR UPDATE SKIP LOCKED`, set a lease and new attempt. Add heartbeat and terminal RPCs fenced by attempt ID and lease owner.
- [ ] Make finalization accept only the current successful attempt and retain the existing `messages_one_role_per_job` guarantee. A stale attempt must not overwrite or preempt the current one.
- [ ] Verify migration locally with `supabase db reset` only after confirming existing local data backup; otherwise apply a non-destructive migration. Test concurrent claims and stale-attempt rejection without contacting gateway.

### Task 3: Gateway provider adapter and independent worker

**Files:** Create `src/lib/analysis/gateway.ts`, `src/lib/analysis/worker.ts`, `scripts/analysis-worker.ts`, `src/lib/analysis/gateway.test.ts`; modify `src/lib/analysis/jobs.ts` only to remove direct model calls.

- [ ] Define a normalized result with `model`, `effort`, `terminalStatus`, `text`, `sources`, `searched`, `usage`, `upstreamResponseId`. Parse final gateway SSE metadata, reject incomplete/failed/EOF and search responses lacking valid cited URLs.
- [ ] Build the request to `/r/<route>/v1/chat/completions` with the configured model/effort, one `web_search` function shim, `llms.web_search.mode: "live"`, and `tool_choice: "required"`. Keep route key server-side; never use the existing `OPENAI_API_KEY` as a fallback.
- [ ] Worker claims jobs, assembles the existing context, consumes the stream to completion, writes attempt status, and finalizes through the fenced DB RPC. Handle subscription exhaustion, temporary 429, auth, and network errors distinctly; unknown outcome never auto-retries. No paid API fallback in this version.
- [ ] Test complete, incomplete, missing citations, duplicate queue delivery, and interrupted stream with local fake gateway fixtures. Run `npm test` and `npx tsc --noEmit`.

### Task 4: API and UI reconnection

**Files:** Modify `src/app/api/sports/[sport]/messages/route.ts`, `src/app/api/jobs/[id]/route.ts`, `src/app/api/jobs/[id]/retry/route.ts`, `src/components/sports-desk.tsx`, `src/app/api/jobs/webhook/route.ts`.

- [ ] POST saves user message and queued job, responds 202 without waiting for any model request.
- [ ] GET reads persisted job/result; it never retrieves an OpenAI Response. UI keeps polling while active and reconnects after reload.
- [ ] Retry creates a new attempt only for a failed or interrupted job. For unknown upstream outcome, show that subscription usage may be repeated and require an explicit retry click.
- [ ] Remove or disable the old OpenAI webhook for gateway mode. Show `waiting_quota` and `relogin_required` clearly, without revealing gateway secrets.
- [ ] Verify sport switch, reload, duplicate request key, and a page-closed worker run with a fake gateway.

### Task 5: Local operation and acceptance

**Files:** Modify `.env.example`, `package.json`, `README.md`; create `gateway/compose.yaml` or equivalent local launcher.

- [ ] Document user-approved `llms add` OAuth login, single Codex-only route, local gateway key placement, and independent worker startup. Bind gateway to loopback/private network; do not print tokens.
- [ ] Ensure `OPENAI_API_KEY` is unused in gateway mode and no automatic paid API fallback exists. Add a startup capability check for the configured model and effort; model-list fallback alone is not sufficient proof.
- [ ] Run local unit/integration tests, lint, TypeScript, and production build. Explain that live Astra/search verification consumes subscription allowance or credits and estimate the scope before executing it.
- [ ] After the user completes OAuth, run one bounded live test to check Astra/xhigh and search citations. Report actual capabilities, usage, and any remaining limits separately from fixture-tested behavior.

**Execution note:** The sports app is currently an untracked directory inside the parent repository. Work on branch `codex/openllms-sports-desk`, preserve existing local data and `.env.local`, and do not commit private credentials or unrelated parent-project changes.
