# Task 1: gateway completion validation

Scope: `gateway.ts`, `worker.ts`, their focused tests, additive completion migration and rollback-only SQL fixtures. No live provider calls, production writes, deploys, Git staging or parent-repository changes.

## Implemented contract

- Every recognized terminal SSE state ends the reader. Failed, incomplete, cancelled and interrupted states throw; partial text cannot become a completion checkpoint. Safe nested quota/authentication codes retain their actionable classification.
- Before extraction/publication, a completed result is saved with exact original text, captured sources, check time and original input snapshot. The private table has RLS, no client grants, a write-once guard and service-only owner/job/attempt/worker/lease-fenced RPCs.
- A claimed retry checks the completion store before loading current context or calling the provider. It reuses original context, instructions, evidence and check time. Missing migration fails clearly before any paid call.
- Transient storage operations receive at most three attempts, with 100/200 ms backoff and bounded production RPC timeouts. This is storage retry, not a new model generation. Existing bounded WS transport recovery is unchanged.
- The publication wrapper calls existing analysis/conversation finalizers without loosening source, record or historical-repair validation. Exact content/metadata/provider identity are required to acknowledge a previously committed publication. Unique assistant/recommendation keys remain in effect.
- Message body text is not prefixed or rewritten for recovery. `metadata.delivery` carries server-derived `delivered_at`, `original_checked_at` and `historical_delivery`. `metadata.completion_recovery` carries original attempt/time and recovery time. Newly inserted recommendation timestamps use original judgment time; message timestamps remain actual publication time. Recovered results never create actual bets.

## Regression evidence

The initial focused run reproduced ten failures: four open-stream terminal cases, four nested quota/auth cases, transient final ownership outage, and missing completion checkpoint. The initial local SQL fixture failed with `Missing completion checkpoint RPC` before the migration was written.

After implementation:

- `npm test -- src/lib/analysis/worker.test.ts src/lib/analysis/gateway.test.ts`: 161 passed after independent-review repair.
- `npm test`: 795 passed at this task's integration checkpoint (other owners continue adding tests).
- Focused ESLint and `npx tsc --noEmit --incremental false`: passed.
- `python3 supabase/tests/support/run_gateway_completion.py`: completion, diagnostics, worker, common-policy-attempt, input-snapshot, conversation, analysis-record, partial-admission and completed-repair fixtures all passed, each inside `BEGIN` / `ROLLBACK` in local `supabase_db_allinsimple-edge`.
- SQL asserts immutable raw/source/check time, expired/stale fencing, private grants/RLS, original-evidence resume, exact committed acknowledgment, one recommendation, no bet creation, separate original/delivery timestamps and conversation admission boundaries.

The expanded SQL run exposed an existing `gateway_conversation.sql` expectation that predated `202610060002`: it compared terminal job metadata without the deliberate `common_policy:null` audit marker. The same failure was reproduced transactionally with migrations capped at `202610270002`, excluding the completion migration and all other new migrations. With coordinator authorization, only that fixture's exact expected job metadata now includes `common_policy:null`; source/message/owner assertions remain unchanged.

Independent review found that an undelimited tail was still parsed after a failed terminal, allowing malformed trailing JSON to obscure the cause or a trailing completed event to reverse failure. Eight new tests first reproduced this. The EOF-tail guard now ignores pending data after every recognized terminal; additional framed-tail and completed-then-failed cases confirm the first terminal remains authoritative.

A later concurrent full-suite run during NBA implementation had four expected in-flight red tests (`coverage.test.ts` NBA scope/review, `record.test.ts` NBA source, `parser.test.ts` NBA narrative import) and the not-yet-created `sports.ts` module. Task 1's focused tests remained green; the coordinator owns final all-workstream integration verification.

## Delivery and remaining limits

Apply `202610270003_gateway_completion_checkpoint.sql` before deploying the new worker. The old worker remains compatible with the additive schema. Rollback requires deploying the old worker before removing completion objects; preserve private evidence if removing the table.

The checkpoint begins after an explicit completed provider terminal event. A crash before that checkpoint reaches the database cannot be recovered from this table; partial output is still rejected. A persistently unavailable database can also prevent the failure status from being saved; the existing lease reaper then marks the attempt interrupted. Explicit retry of a saved completion reuses it; request a new analysis when the completed answer itself lacks valid source evidence. No live gateway behavior or production migration/deployment has been tested.
