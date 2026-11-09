# Review Input Audit Split Implementation Plan

> For agentic workers: use subagent-driven-development, with independent specification then code-quality review. Work only in standalone Fieldnote. No Git staging/commits or unrelated repository actions.

**Goal:** Remove duplicated audit-only information from review model input while preserving the complete analytical evidence and durable audit/recovery contract.

**Architecture:** Keep the full server preparation packet; serialize an audit-free model copy; store the manifest in the existing input snapshot. Preserve all model choices, search settings, semantic rows and captured completion recovery.

**Tech Stack:** TypeScript, Node crypto, existing Supabase worker RPCs, Vitest.

## Task 1 — preparation and worker integration

Owner: one runtime implementer. Files: src/lib/analysis/results-review.ts, worker.ts, context.ts and their existing tests. No other source ownership.

- [ ] Write failing preparation tests asserting that full packet audit fields remain available while parsed model context omits exactly source_messages and original_context_sha256.
- [ ] Assert deep equality of every remaining packet field, original source body, policy, correction, native judgment and all facts/decisions/tickets/conditional-source rows across all eight sports.
- [ ] Observe the intended failures, then create the model packet by excluding only those two fields. Do not filter rows or add an unrelated compaction framework.
- [ ] Replace the single review instruction sentence referring to an inline packet audit index; preserve its completeness warning and all analytical/search/settlement instructions.
- [ ] Write failing worker tests proving snapshot review_preparation contains the original source audit before the gateway call and that rejected snapshot storage prevents any call.
- [ ] Wire the full server audit manifest/hash into snapshot preparation data. Preserve stored preparation data during completion recovery, including old checkpoints with no new fields. Never regenerate captured provider input or instructions.
- [ ] Prove old and new recovered completions make zero provider calls and retain exact source audit where present. Keep non-review job behavior unchanged.
- [ ] Run focused preparation/context/worker tests and typecheck; report RED/GREEN and changed paths.

## Task 2 — independent review and final verification

Owner: coordinator and independent reviewers, no overlapping runtime edits.

- [ ] Verify specification compliance, then independently review code quality and recovery/SQL compatibility. Fix demonstrated defects and re-review.
- [ ] Replay only the pure builder against the already frozen private MLB/tennis input. Compare all non-audit semantic fields deeply and report exact UTF-8 sizes, not token estimates.
- [ ] Run npm test, npm run lint, npm run build and post-build npx tsc --noEmit on the frozen final tree. Save a private source manifest and verification summary.
- [ ] Stage/deploy to existing web/worker only after fresh idle checks. Verify service success, exact deployed source hashes, protected ledger parity and anonymous/auth/private-file HTTP boundaries.

## Task 3 — bounded live measurement

Owner: sole comparison operator; independent blinded reviewer receives no route/usage mapping until verdict lock.

- [ ] Notify the user of two new private MLB calls and the rough historical usage reference before executing. Preserve the prior unknown tennis attempts as unknown and do not retry them.
- [ ] Freeze one shared source context and the two prepared variants before outputs, with call order and A/B mapping fixed. Verify deployed source identity and exact payload hashes.
- [ ] Use the already independently verified production-worker framed ESM/detached transport, per-call start/result checkpoints, correlation IDs and private complete stdout/stderr. Save the full GatewayResult before any projection.
- [ ] Execute the pair once, with no automatic or unknown-failure resubmission. Collect checkpoints without re-executing completed calls.
- [ ] Lock the quality assessment, unblind, and independently recompute provider-reported input/output and total token changes. Preserve missing usage and cache/search limitations.
- [ ] Report deployment, semantic preservation, observed quality and measured token outcome separately. Do not claim byte reduction guarantees token or weekly-quota reduction.
