# Conditional Candidate Actual Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let the owner explicitly record a real entry from a verified conditional candidate even when its event has not been stored.

**Architecture:** Resolve a typed original-source reference on the server, prepare without writes, then create/reuse the event and actual bet through a service-role-only atomic RPC on explicit save. Separate immutable source validity from current recommendation eligibility and preserve missing actual values as NULL.

**Tech Stack:** Next.js route handlers, React/TypeScript, Supabase/PostgreSQL, Zod, Vitest.

**Approved spec:** `docs/superpowers/specs/2026-10-27-conditional-entry-design.md`.

## Ownership and coordination

- Backend worker owns source verification, shared entry DTOs, API handlers, service client, server-side context projection, and TypeScript tests. It publishes the DTO contract before the UI worker imports it.
- SQL worker owns only the new migration and local SQL/concurrency tests. It implements the exact snapshot shape and seven-argument RPC contract in the spec; it does not edit TypeScript files. This work can proceed alongside the backend and UI after contract publication.
- UI worker owns `src/components/sports-desk.tsx`, relevant `src/app/globals.css` changes, and focused form/interaction tests or extracted client-only helpers.
- Root owns integration, review, local verification, credential-presence/deployment checks, and production open/cancel-only QA.
- Workers are not alone in the codebase. Do not revert others' changes. Coordinate changes to existing shared analysis files and adapt to concurrent edits. No worker uses AllinSimple GitHub, creates a remote, launches model analyses, or creates production bets.

## Task 1: Freeze shared DTOs and preserve historical source validity

**Owner:** Backend worker.

**Files:**
- Create `src/lib/records/entry-types.ts`.
- Create `src/lib/records/conditional-entry.ts` and `src/lib/records/conditional-entry.test.ts`.
- Modify `src/lib/analysis/display-candidates.ts`, `src/lib/analysis/actionable-bets.ts`, `src/lib/latest-analysis-table.ts`.
- Extend `src/lib/analysis/display-candidates.test.ts` and `src/lib/analysis/actionable-bets.test.ts`.

- [x] Publish the exact `ConditionalEntrySource` and `ConditionalEntryCandidate` contracts from the spec, with `ConditionalBet.entrySource` as the current overview binding. Keep this DTO module client-safe.
- [x] Add failing tests for original-block and reviewed-overlay refs, ambiguous candidate rejection, cross-owner/sport/job/message/hash rejection, and a valid historical reference whose current projection is empty.
- [x] Run `npm test -- src/lib/analysis/display-candidates.test.ts src/lib/analysis/actionable-bets.test.ts src/lib/records/conditional-entry.test.ts`; verify failures are missing behavior rather than fixture mistakes.
- [x] Extract provenance verification from current-time eligibility. Export a pure verified-source candidate resolver and have current projection continue applying its existing time filters. Retain purpose, coverage, exclusion, conflict, policy, timestamp, byte-evidence, and normalized-key rules. Do not pass a forged past `now`.
- [x] Implement the database resolver with owner-scoped message and completed-job reads, exact job/result-message relation, fixed-path overlay loading, deterministic hash comparison, and explicit unresolved/ambiguous errors.
- [x] Assert the key boundary in tests:

```ts
expect(currentProjection.conditionalBets).toEqual([]);
expect(historicalSource.source).toMatchObject({ kind: 'conditional_candidate' });
expect(historicalSource.schedule.at).toEqual(originalSchedule.at);
expect(historicalSource).not.toHaveProperty('stakeUnits');
```

- [x] Rerun the three targeted suites. Existing current-display tests must continue passing without weakening their assertions.

## Task 2: Atomic conditional save and immutable provenance

**Owners:** SQL worker for migration/SQL fixtures/concurrency tests; backend worker for service client/bet route/TypeScript tests. These file sets do not overlap.

**Files:**
- Create `supabase/migrations/202610270008_conditional_entry.sql` after confirming this sequence is unused; if another worker has claimed it, choose the next unused chronological suffix and tell root.
- Create `supabase/tests/conditional_entry.sql`.
- Create `src/lib/supabase/service.ts` as a server-only, lazy client factory using existing environment variables.
- Extend `src/app/api/records/bets/route.ts`.
- Create `src/app/api/records/bets/conditional-route.test.ts` or extend an existing dedicated bet-route test file if present.

- [x] Create local SQL fixtures for owner A/B, sport A/B, original assistant message, completed job, verified candidate, and an existing event. Wrap fixture assertions in `BEGIN`/`ROLLBACK`; no production URL or key is permitted in tests.
- [x] Add failing assertions for absent-event save, NULL actuals, existing-event preservation, same-key replay, changed-key-payload conflict, cross-owner/sport rejection, immutable provenance, and authenticated execute denial.
- [x] Add nullable `bets.source_candidate jsonb`, a guard trigger that restricts non-null snapshots to the trusted service role and makes them immutable, and the service-role-only SECURITY INVOKER RPC. Keep bet event FK and existing lineage triggers unchanged.
- [x] Implement the transaction sequence from the spec. Use `extensions.digest` for the DB raw recheck. New events use the stable normalized candidate key, NULL start, unknown game state, explicitly marked EVALUATION INCOMPLETE manual registration, and manual `source_ref`. Existing events use `ON CONFLICT DO NOTHING` and are never updated.
- [x] Compare replay payloads using actual database value precision and NULL-safe equality. Include sport and full source identity. A mismatch raises a conflict and rolls back any newly created event. Preserve multiple legitimate different-key entries for the same candidate.
- [x] Implement strict conditional request validation in the bet route. Authenticate and resolve with the user client; only invoke the service client after that resolution. Reject mixed event/market/selection/recommendation fields in conditional mode. Keep the existing event-based route branch intact.
- [x] Assert the route input/result boundary:

```ts
const body = {
  sportSlug: 'tennis', source: candidate.source, confirmed: true,
  idempotencyKey: 'conditional-save-001', stakeUnits: null, executedPrice: null,
};
expect(savedBet).toMatchObject({
  source_message_id: candidate.source.messageId,
  source_recommendation_id: null,
  stake_units: null, executed_price: null, result: 'unknown', profit_units: null,
});
expect(newEvent).toMatchObject({
  event_key: candidate.eventKey, starts_at: null,
  game_status: 'unknown', analysis_status: 'EVALUATION INCOMPLETE',
});
```

- [x] Run focused Vitest tests and the SQL fixture against a local disposable database. Exercise concurrent identical saves using two local connections, confirming one bet and one event. Inject a bet-write failure and confirm zero newly orphaned events. Root must receive the actual commands and observed results.

## Task 3: Read-only preparation and per-message sources

**Owner:** Backend worker.

**Files:**
- Modify `src/app/api/records/entry-review/route.ts`.
- Modify `src/app/api/sports/[sport]/route.ts` and its route tests.
- Extend `src/lib/records/actions.test.ts` or add `src/app/api/records/entry-review/route.test.ts`.
- Modify `src/lib/analysis/context.ts` and focused context tests.

- [x] Add a preparation test that succeeds with `eventId:null`, resolved candidate and source, blank actual fields, and no insert/update/RPC calls.
- [x] Implement the discriminated conditional preparation branch from the spec. Reject mixed source modes. Existing recommendation preparation stays supported.
- [x] Batch-load the jobs referenced by the paginated messages. Return derived `conditionalEntrySources` for verified assistant sources, independent of current display eligibility and the recent 30-job list. Preserve existing recovery DTO behavior. Add private/no-store headers.
- [x] Include a bounded conditional source summary in confirmed-bet model context and an explicit manual-registration evidence label for manual event rows. Original GO remains a historical source decision; placeholder EVALUATION INCOMPLETE is not an original assessment. No model call is made to test this formatting.
- [x] Verify these preparation invariants:

```ts
expect(response.prefill).toMatchObject({
  mode: 'conditional', eventId: null,
  sourceRecommendationId: null, stakeUnits: null, executedPrice: null,
});
expect(response.prefill.candidate.selection).toBe(originalSelection);
expect(response.missing).toEqual([]);
expect(mutations).toEqual([]);
```

- [x] Run targeted route/context tests. Check that invalid, hypothetical, and mismatched sources provide no button DTO while a past valid source still does.

## Task 4: Connect message and overview actions to a usable form

**Owner:** UI worker; starts once shared DTOs and route contracts are published.

**Files:**
- Modify `src/components/sports-desk.tsx` and `src/app/globals.css` only as needed.
- Add or extend focused client form/request-scope tests. A small client-only helper may be extracted if necessary to test payload and signature behavior; do not import server hashing or filesystem code.

- [x] Add conditional message and overview/table action buttons using the server-provided source reference. Keep persisted-recommendation message actions working.
- [x] Pass the candidate row's sport into preparation. Capture request scope and ignore stale responses after context changes. Freeze the form's prepared sport/source for save.
- [x] Extend form initial state as a discriminated union: ordinary existing-event flow versus resolved conditional target. For conditional mode show a read-only resolved target, original selection, date, and uncertainty label, while preserving blank actual price/stake.
- [x] Conditional save is enabled with a valid resolved source even when eventId is NULL. Build only the conditional body specified in Task 2. The ordinary manual form continues requiring an existing event.
- [x] Include full source reference in form signature/session idempotency identity. Preserve the same key on retries and change the key when source or actual values change.
- [x] Show manual registration provenance separately from the original source GO and its historical citation. Cancel closes without saving. Opening the form never calls the bets API.
- [x] Verify payload and interaction invariants with focused tests:

```ts
expect(conditionalPayload).not.toHaveProperty('eventId');
expect(conditionalPayload).not.toHaveProperty('market');
expect(conditionalPayload.stakeUnits).toBeNull();
expect(conditionalPayload.executedPrice).toBeNull();
expect(conditionalPayload.sportSlug).toBe(candidateSport);
expect(signatureFor(sourceA)).not.toBe(signatureFor(sourceB));
```

- [x] Locally test an existing stored recommendation, a conditional source with existing event, and a conditional source without event. Include a table row from a sport different from the current selection and a sport change during preparation.

## Task 5: Integration, review, and bounded deployment QA

**Owner:** Root, with review assistance under the accepted session workflow.

- [x] Review the exact permission boundary, immutable snapshot trigger, SQL rollback paths, source/purpose guards, normalized identity, historical/current split, and all-sport request scoping. Confirm conditional save cannot trust client event/market/snapshot fields.
- [x] Run the focused tests above, then `npm test`, `npm run lint`, and `npm run build`. Investigate real failures without weakening the safety assertions.
- [x] Record local SQL execution and concurrency results. Ensure fixtures rolled back and no production actual entries were created.
- [x] Root verified the exact existing production web service already has the service-role variable through a boolean-only runtime check (true, exit 0). No secret was retrieved or printed and no configuration changed. Use this existing environment; do not create new credentials or broaden privileges.
- [x] Apply root-approved deployment/migration steps for the standalone Fieldnote project only. Do not invoke GitHub operations on the copied AllinSimple repository.
- [x] Production smoke test is strictly: open an original-message action and overview action, inspect resolved target and blank actual fields, verify explicit confirmation wording and schedule uncertainty, then cancel. Do not press save. Confirm no bet mutation request occurred.
- [x] Report the corrected user behavior, tests actually run, migration/deployment status, and any remaining limitation. No completion claim before both missing-event and existing-event local save paths pass.

## Plan self-review

The plan covers both preparation and missing-event persistence, immutable historical source attribution, service-only mutation, cross-owner/sport checks, idempotency and rollback, current versus historical eligibility, message/table discovery, form cancellation, and existing-flow compatibility. DTO/property names are fixed in the spec. Source edits, schema application, and production QA remain separate execution steps; this document itself creates no entry or recommendation.

## Verification record

- Full Vitest: 68 files / 1000 tests passed; lint, TypeScript no-emit and production build passed.
- Local disposable PostgreSQL: full migration chain, missing/existing event saves, NULL actuals, source authority and immutability, replay conflicts, two-session concurrency and rollback passed. Private real-source clone was rolled back and dropped.
- Production migration 008 applied with exact source hash; existing 150 bet rows and normalized SHA unchanged; zero business-row writes, source snapshots remain zero. Existing RLS, policies, lineage and grants preserved.
- Railway web 213cfee9-c73c-4e3f-bfef-c4b6f31aad4c and worker d22a5ba6-1984-4d65-beee-9554b49ce6e9 reached SUCCESS. No gateway deployment or GitHub operation.
- Runtime source hashes and private-file permissions matched; service credential read-only check passed; anonymous latest endpoint 401/private file 404 and client privacy scan passed.
- Production overview action tested while NBA was selected, resolving the Tennis Bucsa target correctly. Original Tennis message action also opened the same target. Actual price and units were blank, confirmation unchecked, save disabled. Both cancelled without saving. Mobile 390px had no horizontal overflow and cancel remained reachable.
- Successful save behavior was tested only on disposable local PostgreSQL; no real production bet was created.
