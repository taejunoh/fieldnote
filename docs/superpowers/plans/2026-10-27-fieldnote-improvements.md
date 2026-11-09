# Fieldnote Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement the owned tasks below. Preserve unrelated edits. No Git commits or PRs in this ignored nested checkout.

**Goal:** Deliver a readable persistent chat with recoverable analysis, traceable records, NBA support and honest recommendation performance.

**Architecture:** Keep the existing Next.js/Supabase/openllms architecture and owner boundary. Add narrowly scoped context retrieval, service-only completion checkpoints and explicit record lineage. Keep analysis and record admission separate.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase/Postgres, Vitest, existing openllms gateway.

## Baseline

- [x] Read current design, implementation and analysis/storage separation documents.
- [x] Establish baseline: 768 tests passed; lint and TypeScript passed.
- [x] Identify note form missing idempotency key; completion persistence gap; terminal SSE handling gap; aged user-context coverage gap; NBA integration omissions.

## Task 1: Gateway terminal handling and durable completion

**Owner:** improvement_architecture.
**Files:** `src/lib/analysis/gateway.ts`, `src/lib/analysis/worker.ts`, their focused tests; additive migration and SQL tests for a service-only completion checkpoint and fenced recovery.

- [x] Add regressions for non-completed terminal events on an otherwise open stream and nested quota/authentication codes.
- [x] Stop reading all recognized terminal events; reject partial output; preserve safe actionable errors.
- [x] Add completion checkpoint, bounded storage retries and replay without a provider call, preserving original evidence and attempt ownership.
- [x] Verify stale workers cannot publish, committed acknowledgments do not duplicate messages/recommendations and no paid fallback is introduced.

## Task 2: Context, reviewed records and performance

**Owner:** improvement_backend; coordinate shared data files with NBA work before changing them.
**Files:** `src/lib/analysis/data.ts`, `src/lib/analysis/context.ts`, corresponding tests; records routes/tests and new bounded lineage/evaluation helpers or additive migrations as needed.

- [x] Retrieve bounded original user messages independently of recent assistant volume and include traceable coverage/limits.
- [x] Demonstrate latest correction survives more than 32 assistant messages without promoting it automatically to an adopted rule.
- [x] Add reasoning examples without historical result leakage or blanket lineup/NY-app eligibility gates.
- [x] Add owner/sport/source-validated record lineage and reviewable note/entry actions; preserve null actual price/stake and replay safety.
- [x] Add frozen-recommendation evaluation with explicit price/contract requirements, sourced outcomes, null ROI for missing prices and separate actual bet P&L.

## Task 3: Chat-first interface

**Owner:** improvement_ui_nba for UI files only; NBA backend integration is a later separate ownership assignment.
**Files:** `src/components/sports-desk.tsx`, `src/app/globals.css`, small presentation helpers/tests if needed.

- [x] Default the latest analysis to a compact collapsed summary, retain an accessible expanded view and preserve deliberate user settings.
- [x] Preserve existing bottom-switch, scroll position and per-sport job/unread tracking; do not reimplement existing working behavior.
- [x] Keep criteria/records rail hidden until opened; verify actual existing CSS before altering its behavior.
- [x] Fix note-form idempotency; expose reviewed source-linked note and explicit entry actions using the backend contracts.
- [x] Validate desktop and narrow mobile viewport behavior, keyboard controls, source folding and preserved conversation area.

## Task 4: NBA integration

**Owner:** assigned after the context/shared slug changes are stable.
**Files:** sport lists and types in analysis/import/job overview, NBA parser, record/coverage source guidance, additive sports/check/import/source-host migration and tests; UI count/list update coordinated with Task 3.

- [x] Add NBA as an independent sport throughout every active allow-list and API path.
- [x] Accept official NBA hosts without widening unrelated source guards.
- [x] Retain source documents in reviewable import; no reuse of WNBA parsing assumptions or automatic entry inference.
- [x] Verify NBA-only criteria and existing seven sports continue working.

## Integration verification

- [x] Review spec compliance and code risks independently, repair material findings.
- [x] Run focused regressions followed by `npm test`, `npm run lint`, `npx tsc --noEmit --incremental false`, and `npm run build` in a way that preserves a running dev server.
- [x] Run migration/RLS/lease/idempotency checks in a local database if available; clearly report unexecuted SQL checks.
- [x] Inspect the resulting UI using the existing local browser without generating a charged analysis.
- [x] Record exact implemented behavior, verification evidence, migrations/release state and any live verification still requiring configuration or a disclosed API budget.

Task 2 evaluation contract refinement: expose optional `supersedesEvaluationId` for append-only correction, preserving the same frozen original source. Owner/sport/recommendation checks and a unique successor implement correction CAS. API views carry `is_current`; summaries must count current versions only. Preserve null returns for incomplete quote/contract and label manual late quote verification.

## Implemented follow-through and release state

- [x] Include bounded original imported-source excerpts for raw-only NBA and other sparse imports, with document SHA, original line/character references, request-time isolation and explicit truncation.
- [x] Preserve append-only evaluation corrections; bind full-game market, line and total direction to the frozen original selection; exclude PAPER and unsupported split/ambiguous settlement from executable performance.
- [x] Apply only migrations `202610270003`–`202610270006` through the guarded production transaction; verify all original ten-table fingerprints remain unchanged and the computed successor relationship responds successfully through REST.
- [x] Finish worker deployment and verify its deployed runtime.
- [x] Deploy the web service and verify its deployed runtime and authenticated smoke behavior without a charged analysis.

Validation and limitations: [Fieldnote improvement validation](2026-10-27-fieldnote-improvements-validation.md). Implementation, local verification and production rollout are complete; practical verification limits are recorded there.
