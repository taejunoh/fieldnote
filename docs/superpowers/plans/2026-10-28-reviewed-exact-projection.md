# Reviewed Exact Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Restore a verified current exact-time body recommendation in overview while preserving original records and preventing the identified future native omission.

**Architecture:** Separate reviewed exact display projection and private manifest v2; reuse immutable source attestation. Existing nonexact entry contract remains unchanged. Future eligible recommendations use native records.

**Tech Stack:** TypeScript, Zod, Next.js, Vitest, owner-scoped Supabase reads.

**Approved specification:** `docs/superpowers/specs/2026-10-28-reviewed-exact-projection-design.md`.

All workers use the standalone Fieldnote directory only. They are not alone: preserve other workers' edits. No Git commits, source-wide rewrites, production writes, model calls or deployment by implementers. All test financial values and IDs are synthetic; real repair evidence stays private.

## Task 1: Shared source attestation and exact projection — backend owner

Files: create `src/lib/analysis/source-attestation.ts`, `source-attestation.test.ts`, `reviewed-exact-bets.ts`, `reviewed-exact-bets.test.ts`; modify `src/lib/records/conditional-entry.ts` and its tests, `src/lib/analysis/private-display-candidates.ts` and tests, `src/lib/analysis/actionable-bets.ts` and tests, `src/app/api/analysis/latest/route.ts` and tests.

- [ ] Add failing fixtures for a fictional exact recommendation whose native record is valid but empty. Assert a single reviewed row before start and zero at start; preserve exact original checkedAt, decision, price and units. Use original source fields from the existing conditional fixture pattern, with an independent completed attempt object.
- [ ] Run `npx vitest run src/lib/analysis/reviewed-exact-bets.test.ts src/lib/analysis/source-attestation.test.ts` and retain expected assertion/import failures before implementation.
- [ ] Implement the separate strict exact overlay schema and manifest v1/v2 reader contract from the specification. Keep the legacy loader return type and nonexact schema unchanged. Add reader tests for v1, mixed v2, exact-only v2, malformed JSON, oversize and incompatible precision.
- [ ] Extract source predicates without weakening them. Verify current owner/job/attempt binding and every trusted metadata/input field previously compared; route both old conditional verification and new exact projection through that helper. Keep request-controlled data out of the attestation decision.
- [ ] Implement exact original coverage/evidence/source/key/time/conflict verification. Source helpers return no row on failure. Append reviewed fields only to successful exact output. Do not create entrySource or a stored recommendation ID.
- [ ] In latest route, fetch full job/current attempt only for potentially matching reviewed rows or existing conditional candidates. Verify matching source before exposing exact rows; retain private no-store headers and latest-job identity. Failed matching projection yields review-needed state.
- [ ] Add adversarial cases from the spec matrix, especially dual mutable rewrite, purpose flags, pregame boundary, normalized source key collision, equivalent native dedupe and native conflict. Add regression that v2 exact-only cannot produce a conditional entry snapshot.
- [ ] Run `npx vitest run src/lib/analysis/reviewed-exact-bets.test.ts src/lib/analysis/source-attestation.test.ts src/lib/analysis/private-display-candidates.test.ts src/lib/analysis/actionable-bets.test.ts src/lib/records/conditional-entry.test.ts src/app/api/analysis/latest/route.test.ts` and require all pass.

## Task 2: DTO and source distinction — UI owner

Files: modify `src/lib/latest-analysis-table.ts`, `src/components/sports-desk.tsx`, `src/lib/betting-overview.ts`, `src/lib/betting-overview.test.ts`; extend `src/lib/latest-analysis-table.test.ts` only where DTO parsing needs coverage.

- [ ] Add the agreed optional ActionableBet fields: provenance reviewed_original_body, originalDecision BET/GO/EARLY GO, displayOnly true. Producer must set them together. Keep ConditionalBet/entry DTO unchanged.
- [ ] Add failing helper assertions that reviewed exact rows preserve their source identity/expiry and do not become conditional entry controls. Confirm native and existing conditional row behavior.
- [ ] Run `npx vitest run src/lib/betting-overview.test.ts src/lib/latest-analysis-table.test.ts` to observe the focused regression failure.
- [ ] Render `원문 추천 · 검토 반영` and originalDecision on reviewed exact rows. Preserve original checkedAt near price. Keep open-chat action; expose actual-entry action only under the existing nonexact conditional discriminator. Do not label reviewed data as a native saved recommendation.
- [ ] Re-run focused tests and `npx tsc --noEmit`. Check row counts, expiry, stale refresh and source labels with synthetic rows. Do not save a production bet during UI QA.

## Task 3: Official-source and future native path — prompt/source owner

Files: modify `src/lib/analysis/record.ts`, `src/lib/analysis/record.test.ts`, `src/lib/analysis/context.ts`, `src/lib/analysis/context.test.ts`.

- [ ] Add a failing synthetic native event/recommendation test using an exact future schedule and official club URL with a :src key. Require acceptance without an official fixture ID when the same URL was searched and cited.
- [ ] Add negative tests for wrong sport, unsearched/uncited URL, arbitrary subdomain, suffix lookalike, credentials and nonstandard port.
- [ ] Run `npx vitest run src/lib/analysis/record.test.ts src/lib/analysis/context.test.ts` and retain the intended rejection before adding the host.
- [ ] Add soccer nashvillesc.com apex/www support through the existing host validator only. Update prompt to require every eligible current exact body GO in native BET form; EARLY GO uses timing early. Explicitly retain valid :src identity support and storage restrictions without altering prose decisions.
- [ ] Preserve existing admission/recovery warnings. No general prose parsing or new financial extraction is authorized. If an explicit incomplete marker is necessary, agree its narrow boolean-only contract with the backend owner before implementation; absence is not proof of completeness.
- [ ] Re-run focused tests and verify no source verification guard was removed.

## Task 4: Integration and reviewed release — coordinator

- [ ] Review each owner's diff against the specification; confirm SQL008, entry types and real ledger code paths are unchanged beyond behavior-preserving attestation extraction.
- [ ] Run `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`. Record commands and results. Re-run only tests affected by review fixes.
- [ ] Build the real exact overlay privately from original source evidence, preserving v1 entries; verify candidate fields, UTF-8 offsets, hashes, current immutable source attestation and original timestamps. Do not put owner IDs or private financial evidence in repository documentation or tests.
- [ ] Coordinator handles approved release using the established allowlisted staging process and fresh protected-state baseline. Confirm current overview shows the intended reviewed row with original as-of and existing nonexact behavior preserved. Open source chat only; never save an actual entry for QA.
- [ ] Record limitations: future prompt consistency is not a mathematical guarantee, arbitrary prose is never auto-converted, and a later exact-row actual-entry feature remains separate.

## Completion evidence

Exact reviewed row displays truthfully before start; old conditional source and actual-entry tests pass; native official URL without fixture ID is accepted only with all normal provenance guards; no raw/ledger mutation, SQL change, model job or fabricated price/start occurred. Return concise test and review evidence to the coordinator, then remain available for independent spec/quality review.
