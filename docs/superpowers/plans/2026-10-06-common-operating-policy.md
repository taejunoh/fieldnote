# Common Operating Policy Implementation Plan

> **For agentic workers:** Use subagent-driven-development with explicit file ownership, tests before implementation, and independent specification and quality review. Do not commit the parent repository's unrelated or untracked application files.

**Goal:** Adopt the user's full 2026-10-06 operating policy once and apply it consistently to all seven sports without rewriting historical judgments or actual bets.

**Architecture:** Add owner-scoped, immutable common-policy revisions separate from sport criteria. An atomic owner-authorized adoption operation supersedes the prior revision, checks the editor's expected revision, and treats an unchanged save as idempotent. Each execution loads one adopted common revision and the current sport's supplements, explicitly orders their authority, and captures the effective revision ID and content hash in its input snapshot and terminal metadata. New requests and explicit retries use the latest adopted revision when execution begins; a running execution never changes policy midway.

**Tech Stack:** Next.js/TypeScript, existing Supabase authentication and Postgres/RLS, existing OpenLLMs worker and durable job flow.

## Approved behavior and boundaries

- Preserve the entire pasted original text, including all supplements; version date alone is not a unique identifier.
- Precedence is current explicit user instructions, latest adopted common operating policy, current-sport analytical supplements, then historical summaries and provisional hypotheses. Exposure limits and ticket/promotion settlement conditions remain applicable.
- Common policy is supplied once per model request, without truncating it into a summary or copying it into seven sport rows. Missing common policy remains explicit; never claim to have read unavailable sport material.
- Keep existing sport criteria, import originals, historical recommendations, entry odds, actual risk amounts, outcomes, and mistake notes unchanged.
- GO and BET both mean a recommendation, never an actual entry. EARLY GO has the same unit grades as GO and records timing separately. LEAN remains a direction note. Incomplete evaluation before a game starts must be distinguishable from a completed price PASS or a conditional WAIT.
- Under the new policy, new GO recommendations use 0.25, 0.5, 1 or 2 recommended risk units. Do not invent 1U's dollar value, auto-assign 0.5U to every candidate, or validate historical actual amounts against new recommendation grades.
- Preserve current source, time, identity, idempotency, worker lease, job-fencing, owner-access and actual-entry guards. No new model/provider, paid API fallback, betting automation, or historical ledger migration.

## Task 1 — Common-policy storage and API

**Ownership:** Backend worker; new `src/lib/common-policy.ts`, `/api/common-policy` route and tests, `supabase/migrations/202610060001_common_operating_policy.sql`, and `supabase/tests/common_operating_policy.sql`.

- [x] Write failing route and SQL regression cases: owner-only reads/writes; cross-owner provenance rejected; singleton adopted revision; optimistic revision conflict; same-content save creates no duplicate; prior body remains readable after update.
- [x] Implement `CommonPolicyVersion` shared contract (`id`, `owner_id`, `title`, `version_date`, `content`, `content_hash`, `status`, `supersedes_id`, `created_at`) and GET `{ current, history }` / POST `{ title, versionDate, content, expectedVersionId }` returning the same shape. No user-supplied owner ID.
- [x] Add constrained owner-global storage and atomic authenticated adoption RPC. Hash the exact UTF-8 content; restrict raw table writes and verify ownership in the RPC itself. Avoid altering sport foreign keys.
- [x] Run route unit tests and rollback-only SQL checks. Confirm allowed grants and RLS independently.

## Task 2 — Shared analysis context and policy semantics

**Ownership:** Analysis worker; `src/lib/analysis/data.ts`, `context.ts`, `record.ts`, `worker.ts`, their tests, and an additional migration only if an existing SQL validator demonstrably requires it. Do not edit the backend's shared-contract file.

- [x] Write failing tests for all seven sports receiving one full common revision, explicit precedence over obsolete sport caps, common version/hash in execution snapshot/audit, ordinary conversation continuity, and retry selecting a newly adopted revision while preserving the prior attempt.
- [x] Load owner-global policy once. Supply it as a labeled policy section rather than an indistinguishable member of sport criteria. Include adopted revision/hash in captured input and successful/failed terminal metadata.
- [x] Make status and unit validation consistent with the approved policy: GO/BET equivalence, EARLY timing, LEAN note, pregame incomplete vs WAIT/PASS, and new recommendation unit grades. Preserve old record parsing/history where no new policy contract applies.
- [x] Keep actual bet finalization inaccessible from recommendations. Verify source/time guards remain enforced, including after game start.
- [x] Run meaningful context, record, data and worker regressions before handing off.

## Task 3 — Shared policy editor

**Ownership:** UI worker; `src/components/common-policy-panel.tsx` and its tests, a small integration in `sports-desk.tsx`, and narrowly required styles only. Do not edit context/API/storage files.

- [x] Add a clearly labeled `공통 운영 기준 · 모든 종목` editor reachable from the existing criteria/records rail. Keep the rail's default-hidden behavior and mobile layout.
- [x] Show adopted version date/revision, exact original text, history, and the scope/precedence explanation. Save once with expected revision. Reload and sport switching must preserve the same policy.
- [x] Show loading, missing policy, save failure, and stale-editor conflict distinctly; never show a failed write as adopted. Do not hide or supersede sport-specific analytical supplements.
- [x] Verify editor read/save/conflict behavior without model calls.

## Task 4 — Review, production adoption and verification

**Ownership:** Root orchestrator for operations; independent deep reviewer for specification first, then code quality/security.

- [x] Root runs the complete `npm test`, ESLint and production build/type checks; review any regressions. Independent reviewer checks policy precedence, history protection, RLS, concurrency and no recommendation-to-entry conversion.
- [x] Apply only the reviewed additive migration to the existing production database. Do not blindly push unrelated pending migration files. Execute rollback-only authorization/history checks and preserve baseline record counts.
- [x] Adopt the full user attachment through the authenticated owner operation, checking exactly one intended owner and SHA-256 `7faaa331a433c40626f8e07707fdfe9e1d753c8792b300ecb61636ef28055643`. Keep private contents/credentials out of public issues and logs.
- [x] Stage changed files into the established secret-free Railway source. Deploy web and worker while jobs are idle; leave the gateway and its credentials unchanged. Confirm deployment IDs, replicas and runtime source hashes.
- [x] Read-only verify the production common-policy API/UI, all-seven sport context assembly with the exact policy/hash, refresh/sport switching/history, and record-count preservation. No model/search call or API spend is needed for this release.
- [x] Record tested implementation, real adoption/deployment evidence, and any remaining limitation in this plan; provide a concise Korean report.

## Baseline

- Current application is an untracked child of a separate portfolio repository. Continue in this authorized checkout; a git worktree based on the parent would omit the application. A private baseline copy of affected files was saved before implementation.
- Parent Buildroom Issues #2–#9 concern portfolio/cost management; no issue was invented for this sports-policy feature and no PR/issue mutation is planned.
- Baseline `npm test`: 388 tests in 38 files passed. Existing Vite deprecation warnings are unchanged.
- Production preflight observed no queued or running analysis jobs. Recheck immediately before deployment.

## Verification results

- Independent review of backend/context/record/worker found one terminal-audit gap. Added reviewed `202610060002_common_policy_attempts.sql` terminal-transition triggers; both queue claim expiry and owner retry expiry now preserve the current attempt snapshot revision. No queue locking or fencing function was rewritten.
- Both additive migrations applied to production and recorded as applied. Production rollback-only `common_operating_policy.sql` and `common_policy_attempts.sql` checks exited 0; fixture writes were rolled back.
- Original attachment adopted through the authenticated owner RPC: revision `3f932372-dcb8-4767-96d3-142f52684079`, date `2026-10-06`, exactly 14,563 UTF-8 bytes, SHA-256 `7faaa331a433c40626f8e07707fdfe9e1d753c8792b300ecb61636ef28055643`. One owner, seven sports, one adopted revision. The full text is stored privately in the database, not embedded in app source.
- Existing production counts before and after adoption: messages 353, sport criteria 61, actual bets 107, mistake notes 108. Active jobs were 0. No new analysis job/model/search was invoked.
- Independent review also identified two editor draft-loss paths and ambiguous failed-save wording. Both draft protections and uncertain-outcome wording were repaired and independently reviewed. A leftover view prop was caught by production type checking and fixed before deployment.
- Baseline private backup retained. No parent Git staging, commit, PR or Buildroom issue mutation.

### Release verification completed

- Root final `npm test`: **440 tests / 42 files passed**. Root `npm run lint`: exit 0 with no findings. Root `npm run build`: exit 0, including TypeScript validation and production page generation. App-local Vitest OXC JSX automatic configuration removes inherited portfolio transform failure; a future native-config-loader warning is nonblocking.
- Web deployed successfully: `59e1e596-4bb5-4052-80ed-e39c1d67e2b8`; worker: `7a795ca8-1939-4885-81da-2179b247c1a7`. Each reports one running replica and zero crashed replicas. Gateway remains deployment `cac4e867-a1d9-473a-9a17-90b4aeb06aed`. Jobs were idle immediately before worker deployment.
- Runtime SSH SHA-256 checks match local source for eight common-policy/API/context/record/worker/UI files on **both** web and worker.
- Production worker assembled real database contexts for all seven sports without inference: exact adopted policy body appears once, content SHA-256 matches original, revision ID identical, sport supplements remain available (MLB19, NFL6, tennis9, soccer5, NHL7, WNBA6, CFB7).
- Isolated owner-session production API verification: original/hash exact, unchanged POST idempotent (still one revision), stale POST 409, all seven sport APIs 200, unauthenticated common-policy GET 401. The isolated test session was revoked locally; existing owner browser session retained.
- Production Chrome: opened global policy editor from initially hidden rail; raw/editor bodies 6,294 characters; switched NFL→tennis, reopened rail and observed identical revision; unchanged save and refresh retained same revision/full body with no alerts. Sport selection survives refresh.
- Final production counts remain messages353/criteria61/bets107/notes108; one adopted revision/one total revision; zero active jobs.
- No new sports analysis, provider inference, or web search was invoked. These checks prove persistence, access, prompt inclusion and contract behavior; they do not claim a freshly generated sports judgment has been assessed against every policy clause.
