# Conditional candidate actual-entry design

Approved bounded design, 2026-10-27. Workspace: standalone Fieldnote. No AllinSimple repository, GitHub issue, PR, or remote operation is part of this work.

## Outcome and existing failure

A real user-confirmed entry can be recorded from a conditional candidate even when that candidate has no persisted recommendation or event. Opening the form only prepares a draft. Saving explicitly confirms the real entry; the system never derives an execution from a recommendation, quote, or button click that opens the form.

The current conditional projection is display-only. Message entry actions are attached to stored BET recommendations. The existing bet API requires an existing event UUID, while `bets.event_id` is NOT NULL and there is no manual-event creation API. Adding a button alone therefore cannot fix candidates whose events were omitted from canonical storage.

## Decisions

- Keep the required bet-to-event FK. Create a missing event and the bet atomically on explicit save.
- Use the verified, normalized original event key, including the existing normalized source-key hash. Do not generate a random manual identity or fuzzy-match event labels.
- Reuse an existing event by `(owner_id, sport_id, event_key)` without changing any of its fields.
- A new manual event has `starts_at = NULL`, `game_status = 'unknown'`, and `analysis_status = 'EVALUATION INCOMPLETE'`. This is an explicitly labeled incomplete manual registration, not a new model judgment. Its notes state that schedule/source record data is incomplete and that the original conditional judgment is preserved separately. Do not set WATCH or BET to imply a new recommendation.
- Preserve the original candidate, original decision such as GO, timing uncertainty, and source provenance in a durable bet snapshot. Never mutate the old message, raw response, recommendation, or candidate overlay.
- Missing actual price and stake remain NULL. Result remains unknown and profit NULL. The confirmation timestamp is the time this record was confirmed, not a fabricated past execution time.
- Past source candidates may support historical actual-entry recording. They do not become current actionable recommendations again.

## Shared DTO contract

Keep serializable types in a client-safe module, `src/lib/records/entry-types.ts`. Server hashing, filesystem access, and privileged clients must never be imported into client code through this module.

```ts
export type ConditionalEntrySource = {
  kind: 'conditional_candidate';
  sourceKind: 'original_block' | 'reviewed_overlay';
  jobId: string;
  messageId: string;
  itemKey: string;
  rawSha256: string;
  candidateSha256: string;
};

export type ConditionalEntryCandidate = {
  source: ConditionalEntrySource;
  eventKey: string;
  match: string;
  market: string;
  selection: string;
  originalDecision: 'BET' | 'GO' | 'EARLY GO';
  suggestedUnits: number;
  priceGate: string;
  schedule: {
    precision: 'not_before' | 'estimated' | 'date_only' | 'unknown';
    dateEt: string;
    at: string | null;
    label: string;
  };
  checkedAt: string;
  deliveredAt: string;
};
```

The reference is not authorization or trusted candidate data. Both preparation and save resolve it server-side. Candidate hashes cover a deterministic serialization of the resolved candidate including normalized event key, market, selection, original decision, suggested units, price gate, schedule, status at assessment, and original source URL. Include source kind and item key to disambiguate original blocks and overlays. Reject ambiguous matches, including duplicate overlays. Never select the first ambiguous match.

Current `ConditionalBet` gains `entrySource: ConditionalEntrySource`. The sport message DTO gains `conditionalEntrySources: ConditionalEntryCandidate[]` as a derived response field, not stored message metadata. Only verified assistant-message candidates appear. Return an empty array for unavailable, ambiguous, hypothetical, or invalid sources.

## Source resolver and historical boundary

Extract the source-validity part of the existing candidate projection into a shared pure verifier. Keep current display eligibility as a separate step. Preserve all existing projection behavior and tests for current cards.

The verifier retains owner/sport/job/message binding, immutable raw hash, original and saved purpose checks, source timestamp consistency, coverage identity and exclusion checks, stable normalized keys, canonical conflict checks, adopted-policy conditions for GO aliases, and overlay evidence byte ranges/text/hashes. Invalid hypothetical and retrospective-hypothetical source purposes are never promoted to entry candidates. The source must identify one target; no free-text reconstruction is allowed.

Current date expiry and known-start-versus-now filtering belong to current display eligibility. A historical entry source uses the real current clock for integrity checks but does not need to be currently actionable. Never fake `now`, alter the original schedule, or call a past candidate a fresh recommendation. Original at-assessment requirements and conflict checks remain enforced.

The database resolver, `src/lib/records/conditional-entry.ts`, loads the owner/sport assistant message and its completed analysis job and verifies `job.result_message_id === message.id`, same owner/sport, analysis result kind, and original source identity. It loads the existing private overlay file through the existing fixed-path loader. No request-controlled paths or URLs, model calls, or external research are involved.

For the paginated sport GET, batch-load jobs for the returned messages' `analysis_job_id` values rather than relying on the existing 30-job recent list. Run the shared verifier and derive `conditionalEntrySources` per message. This keeps historical message actions available after the current overview expires. Mark responses private/no-store because the projection may depend on server-private reviewed overlays.

## Preparation API

Extend `POST /api/records/entry-review` with a discriminated conditional source path:

```ts
{ sportSlug, source: ConditionalEntrySource }
```

This path resolves the candidate and looks up the exact existing event. It returns:

```ts
{
  requiresConfirmation: true,
  prefill: {
    mode: 'conditional',
    source,
    candidate,
    eventId: existingEvent?.id ?? null,
    market: candidate.market,
    selection: candidate.selection,
    sourceMessageId: source.messageId,
    sourceRecommendationId: null,
    stakeUnits: null,
    executedPrice: null
  },
  missing: [],
  notice: 'Confirm the actual target and entry. A missing event is registered only when you save.'
}
```

`eventId: null` is a valid prepared target in this mode; it is not an unresolved target. The existing persisted-recommendation preparation path remains available. Reject requests mixing conditional source with arbitrary event, recommendation, or message IDs. Preparation performs no insert, update, RPC mutation, or model invocation.

## Save API and permission boundary

Extend `POST /api/records/bets` with a separate conditional request branch:

```ts
{
  sportSlug,
  source: ConditionalEntrySource,
  confirmed: true,
  idempotencyKey: string,
  stakeUnits: number | null,
  executedPrice: number | null
}
```

The resolved candidate supplies event identity, market, and selection. Do not accept an alternate event ID, market, selection, recommendation ID, arbitrary source snapshot, schedule, or actual timestamp in this branch. Actual prices must satisfy existing integer American-price constraints; actual stake must fit the database numeric precision and be positive when present. Reject out-of-range values before the database write. Do not round a request silently and then compare its unrounded value during replay.

Authenticate with `requireOwner()` and use the authenticated client for source reads. Only after successful resolution invoke a narrowly scoped server-only service-role RPC client. `record_conditional_entry` is SECURITY INVOKER with execute revoked from PUBLIC, anon, and authenticated and granted only to service_role. Do not expose a browser-callable RPC that trusts a caller's verified-candidate JSON.

The root confirmed on 2026-10-27 that the exact existing production web service already has `SUPABASE_SERVICE_ROLE_KEY`: a boolean-only runtime check returned true with exit 0. No secret value was retrieved or printed and no configuration was changed. Use that existing server environment; no new credential or privilege expansion is required. Future environment checks must remain boolean-only, without values or environment dumps.

## Durable storage and atomicity

Add nullable `bets.source_candidate jsonb` for existing-row compatibility. The versioned snapshot contains the source ref, original normalized candidate, original URL as a historical citation, original checked/created/delivered times, original decision, and a manual-confirmation provenance label. It is not a new recommendation row.

The backend and SQL workers share this exact JSON shape and RPC signature:

```ts
export type StoredConditionalEntrySource = ConditionalEntryCandidate & {
  version: 1;
  provenance: 'manual_confirmed_conditional';
  createdAt: string;
  sourceUrl: string;
  statusAtAssessment: 'scheduled' | 'unknown';
};
```

```sql
public.record_conditional_entry(
  p_owner_id uuid,
  p_sport_id uuid,
  p_request_key text,
  p_confirmed boolean,
  p_source_candidate jsonb,
  p_stake_units numeric,
  p_executed_price integer
) returns jsonb
```

All seven RPC arguments are required; nullable actual values are passed explicitly. The snapshot's `source` field contains the reference, `eventKey` is already normalized, and `match` is the verified label. `schedule.at` retains only its original bound/estimate; it must never populate `events.starts_at`. Expected conflict SQLSTATE is `23505`; invalid input/lineage is `22023`; unavailable required source is `P0002`. The API maps these to 409, 400, and 404 respectively. New saves return `alreadyRecorded:false`; exact replays return `alreadyRecorded:true` and `eventCreated:false`.

A trigger permits a non-null snapshot only through the trusted service role, binds it to the bet owner/sport/message and resolved event/market/selection, requires a NULL recommendation ID for this path, and prevents snapshot changes after insertion. A browser can continue making its own ordinary manual records without a verified snapshot; it cannot forge one through direct PostgREST inserts or updates. Keep existing lineage triggers.

RPC transaction order:

1. Validate `confirmed`, owner/sport, request-key shape, actual-value bounds, snapshot shape and trusted role. Explicitly scope every lookup because service_role bypasses RLS.
2. Lock the relevant owner-scoped source job/message and recheck their relationship and the stored raw hash using the existing `extensions.digest` convention. Verify frozen original times against the source. The server verifies private overlay evidence; SQL checks the source has not changed between validation and write.
3. Serialize identical owner/request keys and inspect any existing bet before creating an event. Same full conditional payload returns that bet; different sport, source, market, selection, or actual values raises a conflict.
4. Insert the normalized event with `ON CONFLICT (owner_id,sport_id,event_key) DO NOTHING`, then resolve the event ID. Existing row fields stay untouched.
5. Insert the actual bet with `source_message_id` and frozen `source_candidate`, NULL `source_recommendation_id`, `result='unknown'`, and NULL profit. Handle a concurrent request-key conflict by comparing the winner; mismatch aborts the whole transaction.
6. Return `{ bet, alreadyRecorded, eventCreated }`. Map expected invalid, unavailable, and conflicting inputs to 400/404/409 responses.

A later failure or idempotency mismatch must roll back a newly inserted event. Multiple distinct actual tickets for one candidate remain permitted; idempotency is per explicit request key, not a global candidate-to-bet uniqueness constraint.

The new event's `source_ref` is a recognizable manual marker such as `manual-confirmed:conditional:<message-id>:<candidate-hash>`. Notes identify manual registration and incomplete schedule/source record data. Do not put the original URL in `source_ref` where the current UI would suggest a new analysis-source citation. Display the snapshot URL as an original historical citation with its old verification limitations.

## UI and future result linkage

Add actual-entry actions to both the conditional overview/table and the corresponding original message. Overview actions carry their row's sport, not the currently selected sport. Capture request scope before preparation; ignore stale responses when the selected context changes. Freeze the form sport/source so a later UI switch cannot retarget a save.

The conditional form shows the validated target, original market/selection, date, and NB/estimated/unknown schedule. It does not require the existing event dropdown when the server has resolved a conditional target. Actual price and stake start empty. Display original suggested units and price gate separately if shown at all. The save button explicitly says that it confirms an actual entry; cancel only closes the form. Use source ref as part of the existing session idempotency signature. A changed source must not reuse another source's key.

Existing stored-recommendation message actions remain functional. Do not change ordinary manual-entry requirements to allow arbitrary event-free submissions. Manual source provenance must visibly distinguish registration completeness from the original model GO decision.

Keep the stable normalized event key in the event row and frozen snapshot. Existing result updates operate on `event.id`; the bet is linked to that ID normally. Future canonical ingestion with the same stable key can resolve the same event rather than a random manual placeholder. No automatic result write or source verification is added. Different original URLs can yield different source-hash keys; do not invent a fuzzy merge to hide that distinction.

In analysis context, mark manual event `analysis_status` as registration completeness, not original model judgment, and pass a bounded compact source-candidate summary with confirmed bets. This prevents result review from interpreting the new EVALUATION INCOMPLETE placeholder as a retroactive change to GO. Preserve original URL limitations and actual NULL values.

## Validation and rollout boundaries

Required tests: missing-event preparation writes nothing; save creates one event and bet; existing event unchanged; NULL actuals preserved; original candidate never becomes actual units; cancellation writes nothing; concurrent replay creates one record; conflicting replay rolls back; failed bet insert leaves no event; cross-owner/sport/message/job/item/hash/overlay attacks fail; authenticated direct RPC/provenance forgery fails; past candidates work only as historical source; hypothetical/conflicting candidates fail; all-sport overview and scope-change races do not retarget entries; stored-recommendation flow still works.

Use local PostgreSQL fixtures/transactions and rollback for SQL tests. Production QA may open the form, inspect target, blank actual fields, uncertainty labels and confirmation wording, then cancel. Never save a real production entry during QA. Do not request new model runs or spend model-analysis credits. Schema deployment requires the root's normal integration decision and verified web credential presence; this document does not authorize inventing production ledger data.
