# Analysis and storage separation implementation plan

> **For agentic workers:** Use subagent-driven-development with a bounded implementation worker and independent design/code review. Current user approval covers implementation and the thirteen-fixture reassessment.

**Goal:** Make shared model instructions distinguish substantive assessment from recommendation eligibility and structured persistence, then demonstrate the distinction with a new soccer assessment.

**Architecture:** Update the existing shared analysis instruction contract rather than introducing new record fields or disabling validation. Existing common-policy status semantics and runtime provenance/timing protections remain authoritative. Reassessment is a new normal job; previous responses remain immutable history.

**Tech stack:** TypeScript, Vitest, Next.js, existing Supabase records and durable openllms worker.

## 1. Reproduce the missing contract

Owner: bounded fast-worker. Files: `src/lib/analysis/context.ts`, `src/lib/analysis/context.test.ts`, and only if needed `src/lib/common-policy.test.ts`.

- [x] Add failing tests against actual assembled analysis/chat instructions in both common-policy modes. Assert that available matchup/price assessment is independent of record admission, missing explicit pregame flags are not evidence of started play, retrospective hypotheticals remain excluded, and one rejected candidate does not instruct blanket omission of otherwise eligible candidates.
- [x] Run focused tests before implementation and capture the expected assertion failures. Do not replace adopted-policy EVALUATION INCOMPLETE semantics or alter price PASS/conditional WAIT meaning.

## 2. Implement and verify the common contract

- [x] Add concise shared instructions covering body analysis, GO/BET eligibility, per-candidate structured eligibility, status uncertainty, and preservation of original judgments. Do not require final lineups universally, invent a new machine-state prerequisite, infer actual bets, or allow post-start BET records.
- [x] Preserve current schema, source membership/citation checks, exact official-source rules, future BET timing and common-policy units. A missing source admission may limit records without erasing the body judgment. A genuine missing analytical input remains incomplete.
- [x] Run focused tests, the full `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`. Independently review spec compliance first and code quality second.

Verification: RED eight failures before the change; focused analysis boundaries 256 passing; full suite 740 passing across 51 files. Root independently reran the full suite at 11:06 ET with the same 740 passing. Lint, TypeScript and build passed. Independent spec compliance and quality reviews passed. The instruction function is shared by all sports; repeated sport labels in the contract test are not independent sport-specific integration runs. Runtime source SHA-256: `812c483d7e761aa2f1a6d9b19b6b3083b5fadc4353259d945f45b70bf400cd27`.

## 3. Apply to existing production services

Owner: operations agent; no app-code edits. Root authorizes the concrete reviewed package after verification.

- [x] Freeze full-row baseline and policy/source/runtime hashes. Verify no active job before restart. Use existing services and plans only; no new resource, upgrade or paid API fallback.
- [x] Release reviewed web/worker files using existing guarded deployment procedure; gateway remains unchanged. Verify both deployed runtime hashes and service health. Authenticated analysis output is checked again with the reassessment.

Production release: web `REDACTED-ID`, worker `REDACTED-ID`; both SUCCESS/RUNNING and all 121 runtime files per service match the reviewed packages. Gateway unchanged. Existing 473 events, 631 recommendations, 107 bets, 157 notes, policies and protected source/input rows remain unchanged. Only `src/lib/analysis/context.ts` changed in each production package. Private release proof SHA-256: `94fb61819f31380282d898cd27997c8593b1cfb8a3702a17a60a1c2a8a43b0fc`.

## 4. Reassess the thirteen soccer fixtures

- [x] Prepare an exact thirteen-pair October 27 ET normal `analyze_today` request, including Serie A three, DFB-Pokal eight and EFL Cup two. Explicitly supersede the former task-specific blanket exclusion. Recheck current schedules, prices and matchup evidence during execution.
- [x] Pin request, model/provider/effort, resource configuration and idempotency key. Submit at most one logical openllms / gpt-6-astra / xhigh job, with no automatic owner retry or paid fallback.
- [x] At completion audit each of thirteen dispositions, actual substantive price comparisons, uncertainties, current starts, sources and any structured rows. Do not count schedule/price collection as completed price analysis. Do not force PASS or invented probabilities to fill missing work.
- [x] Verify source response and input snapshots, authenticated body/latest-analysis output, and full-row preservation of existing bets, notes, policies, events and recommendations. Report actual completed versus incomplete work and record eligibility separately.

Execution: job `REDACTED-ID` accepted at 11:23:51 ET and completed once at 11:48 ET, openllms / gpt-6-astra / xhigh, local logout HTTP 204. Independent actual-input review confirms instructions SHA-256 `29fc1d2ff6801d867ce83b2f4b5d4d6c6684d6d266779236e9485c76a0babe0a`, exact current thirteen-fixture request and current policy. Old strict request and responses remain byte-identical history. All thirteen fixtures were assessed, nine with some completed price judgments and four deferred. This is not completion of every market. The source-admission failure and subsequent verified partial recovery are documented below.

## Repository constraint

This checkout is ignored inside an unrelated parent Git repository. Do not stage, commit, create a PR or modify that parent. Keep private operational evidence outside the checkout with restrictive permissions.

## 5. Integration follow-up: preserve verified rows when another source fails

Observed evidence: job `REDACTED-ID` completed once at 11:48 ET, result `REDACTED-ID`. All thirteen fixtures have body assessments; nine have some completed price judgments, four are deferred. Two original event URLs are absent from captured sources. Original raw proposes 8 events/14 recommendations; atomic source validation persisted 0/0. The original response and all 249 captured sources remain immutable. Integration proof SHA-256 `f260be178d27a4a17865301fe214974b08e5f8fc07105c4d49bf753e92a388fc`.

### Runtime source admission — fast-worker ownership

Files: `src/lib/analysis/record.ts`, `record.test.ts`, `worker.ts`, `worker.test.ts`.

- [x] Write failing synthetic regressions for mixed valid/unverified sources, exact dependency exclusions, all-rejected behavior and fatal errors hidden behind an invalid source.
- [x] Add explicit `partial` extraction output and version-1 `record_admission` diagnostics. Permit only the three existing source admission failures to exclude rows. Preserve all original fatal validation and revalidate accepted rows.
- [x] Keep original response/source/coverage evidence and display actual partial counts in worker output. Do not describe partial persistence as full success or original-only storage.

### Historical repair — deep-reasoner ownership

Files: new `supabase/migrations/202610270002_partial_record_admission.sql` and synthetic SQL tests.

- [x] Implement `repair_completed_analysis_partial` for version `source-admission-partial-v1`, with service-only permissions and independently server-derived accepted subset/diagnostics. Preserve old functions and use original check time.
- [x] Prove stale CAS/payload tampering/non-service execution/conflicting rows rejection, idempotent exact repeat, fatal prefilter checks, original evidence preservation and atomic insert/audit behavior in rollback tests.

### DTO and presentation — operations/integration worker ownership

Files: existing record-recovery parser, API/DTO/partial status presentation and focused tests only; no SQL or record/worker overlap.

- [x] Add accurate normal-partial and historical-partial UI/DTO counts, reasons, original judgment time and repair time. Preserve complete v1/v2 contracts and original stored body bytes.

### Verification and guarded production recovery

- [x] Independently review code and SQL; run focused/full tests, lint, typecheck, build and actual-case SQL rollback validation.
- [x] Freeze updated packages and a fresh protected baseline including this completed job/result/input. Release to existing idle web/worker only; apply the reviewed new SQL path without modifying old functions or resource plans.
- [x] Invoke one exact CAS-bound historical partial recovery with original evidence. Verify the expected 6 event/12 recommendation subset, two source exclusions and their two dependent recommendation exclusions. Check repeat no-op locally and authenticated app display; preserve all old ledger/policy/source rows.
- [x] Report the substantive assessment limitations separately from source admission and recovery results. No extra Fieldnote model call is needed for this repair.

Verified implementation: full suite 768 passing in 52 files, lint, typecheck and build passed. Independent core, DTO/UI and SQL review passed after fixing fatal-schema, canonical-URL, whitespace and concurrency cases. Historical SQL intentionally rejects unsupported URL forms and non-BMP structured strings; normal runtime supports its existing formats. Actual-case TS/SQL subset/admission parity and full repair/replay/stale-CAS rollback tests passed.

Second production release: web `REDACTED-ID`, worker `REDACTED-ID`, all 122 runtime files per service verified, gateway unchanged. Only the two additive service-only functions were applied; previous official source helper and full-recovery RPC definitions/ACLs remain identical. The first DDL confirmation reported a false mismatch because PostgreSQL and Python sorted function signatures differently; signature-keyed hash/ACL comparison confirmed equality. DDL was applied once, never repeated.

One live partial-repair RPC restored six events and twelve original judgments. Final counts: 107 bets, 157 notes, 479 events, 643 recommendations. All old 473 event/631 recommendation rows, all bets/notes/policies, original response/source249/check time/input/coverage/failure and protected history remain unchanged. Only the six approved metadata fields were updated with partial-admission/recovery provenance. Original checked time `2026-10-27T15:48:21.380Z` and result creation `2026-10-27T15:48:21.658412Z` remain distinct from actual repair time. Authenticated conversation/latest-analysis show partial 6/8 events and 12/14 judgments, same original job; logout HTTP204. Live repair proof SHA-256: `847ad8f0236cd1bdff9f16f4ee0fdead660e1292147e50952aafa3cf48d20903`.

## Completed independent four-fixture follow-up

The four initially deferred fixtures received bounded official-team, lineup, market and settlement research. A separate assistant/operator assessment, as of 12:16 ET, was published once at 12:30:14 ET in the same soccer conversation, message `REDACTED-ID`. It has no analysis job, no forecast-record writes and no new actual bet/note. The assessment adds no GO, distinguishes WATCH/conditional WAIT/unresolved value, and identifies one conditionally dominated Köln ML quote without approving the alternative. It reflects the newly observed Essen lineup without inferring an injury from a missing name. It does not relabel all markets as complete or pretend the other nine fixtures were rechecked at the supplement time.

The original thirteen-fixture result remains the latest normal analysis and its verified partial DTO remains unchanged. Supplement body SHA-256 `540182dd2626bc769258b2993fcc191610a30807bb1e7a5251945c50933b1e7c`; authenticated append proof `933de8553af3d8edd4833e317f4012976dadcec84714d728549ee14dd73c050d`. Independent production audit `3438a3017ec9823fcf776a5a3e36f824f6aa35648b75367057358adbc9a69355` verifies the actual six/twelve subset and all original ledgers. Root's fresh read-only final check at 12:31:29 ET confirms counts, active jobs zero, original evidence, current partial record and exact unique supplemental body; proof SHA-256 `fd59352504b56017bb9b6d1f8da09f44aa81749f329801e86a2f00fb00b5e5c8`.

This task created one normal Fieldnote analysis job, one independently identified conversation supplement, two existing-service releases, and an additive recovery path. No paid API fallback, new resource, plan upgrade, actual bet, note or policy adoption was performed. Usage checks stayed above the user's ten-percent reserve threshold; the latest pre-publication check showed 35% remaining in the available weekly window.
