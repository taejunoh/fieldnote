# Results Review Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver a working deterministic preparation and stored-result reuse path feeding the unchanged full deep review, with faithful P&L and measurable usage.

**Architecture:** Prepare a versioned scoped packet in the existing job input snapshot; run the existing model once with review-specific instructions and live search; finalize a review-only response and preparation audit in existing final metadata. Reuse immutable completion evidence for recovery. No new database schema or automated ledger writes.

**Tech Stack:** TypeScript, Zod where useful, Node crypto, Next.js routes, Supabase reads/existing worker RPCs, Vitest.

**Approved specification:** `docs/superpowers/specs/2026-10-29-results-review-efficiency-design.md`.

All workers operate only in `<Fieldnote workspace>`. They are not alone and must preserve other edits. No staging, commits, worktrees, live/model/API runs, DB mutation, deploy or private fixtures. User approved implementation; do not request another design approval. Detailed code is owned by implementers; this bounded plan specifies interfaces, invariants and concrete test cases rather than duplicating entire modules.

## Task 1: Runtime preparation, evidence reuse and deep call — runtime owner

Files: create `src/lib/analysis/results-review.ts`, `src/lib/analysis/results-review.test.ts`; modify `src/lib/analysis/data.ts`, `context.ts`, `worker.ts`, and their corresponding tests. Runtime owner alone edits these shared runtime files.

- [x] Add synthetic packet fixtures containing one native BET, PASS, WAIT, one body-only report, one exact linked actual ticket beyond the recent 30 records, and one unrelated ticket. Assert all original decision evidence remains; only exact actual matches are candidates; unknowns stay explicit.
- [x] Run `npx vitest run src/lib/analysis/results-review.test.ts` and confirm the new behavior fails before implementation.
- [x] Implement the pure preparation seam returning `{ context, packet }` and separate review instructions in the specification. Preserve original bodies/policy/corrections; do not parse arbitrary body text into tickets or silently label incomplete coverage complete. Hash the exact original context bytes and retain bounded completeness markers; do not claim order-independent semantic caching.
- [x] Extend owner/sport/cutoff-scoped data reads to load linked records outside generic recent limits. Include stored event/bet result source and checked-time fields in the review input. Paginate bounded sets and surface limits. Never guess records from names alone.
- [x] Reuse only owner/sport-scoped stored event/bet result records with their original sources/check times. Mark unverified, missing or conflicting records for fresh deep search. No new model fact block or cross-job model-observation cache in this increment; preserve raw response/source evidence.
- [x] Build dedicated review instructions preserving full model/effort and all-decision reasoning. Require live retrieval for absent/unverified/conflicting results and causal evidence, plus truthful source timestamps. Remove irrelevant new-pregame candidates/evaluation instructions; use review-only finalization that does not generate current event/recommendation rows or append irrelevant full-slate coverage/extraction warnings. Preserve source verification gates. If packet preparation cannot parse legacy input, preserve that original context verbatim and continue the dedicated review instructions; never drop or shorten it.
- [x] Wire preparation before existing snapshot creation; review-only finalization after checkpoint storage; final metadata contains versioned packet identity, preparation status and counters. Existing snapshot/lease/retry/complete-recovery paths remain unchanged; never add top-level completion payload fields.
- [x] Add tests for all eight sportSlugs, wins and passes receiving review, generic/ambiguous/comparison scopes, source cap, body-only evidence, invalid input/unknown event/conflicting stored result handling, and changed actuals or input ordering changing the original-context byte hash.
- [x] Add worker tests: required live search and original model/effort unchanged; non-review byte behavior retained; snapshot persisted before execution; final metadata binds the original packet and raw response; completed recovery makes zero gateway calls and uses original packet/instructions; review-only content has no irrelevant extraction/coverage warning; no new ledger writes.
- [x] Run `npx vitest run src/lib/analysis/results-review.test.ts src/lib/analysis/data.test.ts src/lib/analysis/context.test.ts src/lib/analysis/worker.test.ts` and require pass.

## Task 2: Deterministic settlement and measured usage — independent helper owner

Files: create `src/lib/records/settlement.ts`, `settlement.test.ts`, `src/lib/analysis/review-usage.ts`, `review-usage.test.ts`; modify `src/app/api/records/bets/[id]/result/route.ts` and its tests. No gateway changes are owned by the independent helper worker. Do not edit runtime owner's files. Send exported helper signatures before integration.

- [x] Add tests for fractional stakes, positive and negative American prices, won/lost/push/void, missing price/stake, invalid nonfinite values, and unsupported result. Existing supported output and four-decimal rounding must be identical.
- [x] Run `npx vitest run src/lib/records/settlement.test.ts` and confirm intended failures, then extract the existing BigInt calculation into a pure helper returning a nullable profit. Update the result route to delegate without changing sourceConfirmed, source URL, owner or missing-actual semantics.
- [x] Export `calculateBetProfit(result: string, stake: unknown, price: unknown): number | null` for packet preview only. Keep unsupported promotions/cashout/partial/ambiguous settlement unresolved. No new route calls or database behavior.
- [x] Add pure review input/attempt metrics helpers. Count UTF-8 bytes, not JS string length; preserve original versus prepared sizes and actual usage availability. Export typed results for the runtime owner.
- [x] In the pure usage helper, preserve the distinction between missing usage and reported zero. Do not emit search/tool counts in this increment; absent counts mean unknown, never zero, and searched is a boolean rather than a count. Never infer counts from sources. Runtime integration owns any narrowly necessary gateway changes; no provider/schema refactor is required.
- [x] Test UTF-8 bytes versus JS length, original/prepared size differences, explicit zero versus missing counts, stable packet counters and no raw content in audit. No accounting field may imply unknown failed attempts cost zero or convert token count to subscription cost.
- [x] Run `npx vitest run src/lib/records/settlement.test.ts 'src/app/api/records/bets/[id]/result/route.test.ts' src/lib/analysis/review-usage.test.ts` and require pass.
- [x] Report helper interfaces and tests to runtime owner; preserve ongoing edits.

## Task 3: Integration, adversarial review and completion — coordinator

- [x] Integrate helper exports into packet preparation and worker final/failure telemetry. Confirm requested/reported model and effort remain separate and no model downgrade or additional provider call was introduced.
- [x] Review the spec against execution, especially actual stored-result reuse in the deep input (not decorative JSON), lookup fallback, all-decision evidence preservation, no automatic notes/results, source membership, identity ambiguity and legacy completion recovery.
- [x] Check offline parity with deterministic synthetic fixtures spanning all eight sports. Compare legacy original evidence IDs/body hashes/policy/corrections to prepared input: no required original evidence lost. P&L parity is exact; no actual entry invented. A report with body-only decisions must retain its full original body and an explicit review obligation.
- [x] Run `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`. Run focused tests first after fixes; do not rerun already-passing broad checks without a new change or unresolved concern.
- [x] Record local test results and implementation limitations. Default review routing can use the dedicated instructions only with the above invariants tested. Do not claim empirical analytical parity, eight adapter coverage, measured savings, or successful provider model verification.
- [x] Prepare the private paired-comparison protocol from the spec for a later explicitly authorized run: frozen inputs, identical requested model/effort, cases stratified by decision/outcome/ambiguity, blinded material-quality assessment, all successful and failed attempts included. No live run in this task.

## Completion evidence

Deliver file references, actual commands/results, all-sport local coverage, deterministic P&L and lineage/recovery evidence, and specific unknowns. The workflow must truly prepare/reuse stored result records with source lineage and fall back to deep live search for missing/unverified facts, while preserving every original reviewed decision. No production state changed. Do not invent token savings or account usage attribution.

## Execution record — 2026-10-29 ET

Implemented locally and preserved in the standalone workspace without staging or commits. Independent specification and code-quality reviews passed after regressions covered missing historical structured decisions, older conditional-source provenance, nonstandard settlement and numeric-string profit comparison.

Coordinator fresh verification after the final runtime fixes: `npm test` 1,146 tests / 76 files passed; `npm run lint`, `npm run build`, and post-build `npx tsc --noEmit` exited 0. The existing Vitest/Vite config-loader warning remains; no new test warnings were introduced.

The paired-comparison protocol is prepared in private verification storage only. No Fieldnote live analysis job, paid API fallback, production deployment, operating ledger mutation or empirical model-quality comparison was performed. Synthetic byte-count comparisons are not actual provider token savings or weekly subscription usage.
