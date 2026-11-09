# Results review efficiency design

User approved proceeding on 2026-10-29. This design implements the approved separation without another approval gate. Work is confined to standalone Fieldnote. No live jobs, model/API experiments, database mutations, deployment, commits, staging, or parent-repository changes are part of implementation verification. Documentation and fixtures contain synthetic data only.

## Goal and quality boundary

Separate deterministic result-record preparation, actual-ticket reconciliation, and P&L from substantive review. Preserve the existing requested deep model and reasoning effort (approved Astra/xhigh); do not downgrade it, select only losses, or reduce the reviewed decision universe. Cover all eight `sportSlugs`: mlb, nfl, cfb, soccer, tennis, nba, wnba, nhl. Sport support means the same safe workflow, not a claim of eight independent official-results adapters.

Implement the dedicated review path as the normal `review_results` path. Do not introduce a three-mode framework or claim measured savings. Preserve original decision bodies, adopted common policy, sport criteria, relevant original user corrections, source identity, and current truncation disclosures. Reduce unrelated pregame prompt machinery and duplicated mechanical reconstruction first. Never shorten evidence merely to meet an arbitrary token target.

## Existing seams

`data.ts` loads owner/sport-scoped records and pins review source messages beyond the recent-message window; `context.ts` already omits only clearly out-of-date assistant reports. The worker snapshots context/instructions, checkpoints the full completed provider result, and atomically finalizes a message. `gateway.ts` performs live search with the job's model/effort. Result and mistake-note routes are separate confirmed writes. Bet P&L is already deterministic and preserves missing actuals as unknown.

Reuse those seams. No migration is required. `save_gateway_completion` accepts only top-level version/result/checked_at; do not add a new top-level stage field or overwrite the checkpoint. The input packet lives in snapshot context. The preparation audit lives in final message metadata. The completed original response remains in the existing checkpoint; no new model fact block is required. Existing fencing, heartbeat, completion recovery, and immutable original input checks remain authoritative.

## Phase 1: deterministic preparation

A pure builder produces a versioned packet from trusted, owner/sport-scoped records. It makes no model call and no network request. It distinguishes stored event outcomes, stored bet settlements and unresolved result tasks. A stored HTTPS URL is a citation, not proof of fresh or independent fact verification.

The packet contains:

- Scope: sport, date/scope basis, request message ID, cutoff, source message IDs, original content hashes, policy revision/hash, coverage limits and input hash.
- Decision manifest: every native recommendation and coverage assessment in the scoped original reports, including GO/BET, PASS, WAIT, WATCH, PAPER and incomplete judgments; preserve report-level original bodies as mandatory review evidence when decisions are body-only. A body-only marker is not permission to invent a structured decision. No selection based on eventual outcome or bet existence.
- Event facts: exact canonical identity where available, original result/status, original source URL and checked time, source record/message ID, evidence class, original record hash, and conflict/missing/stale reasons. Original source arrays stay intact; stored-result citations never get added to a later call's fresh search source array.
- Actual-ticket candidates: exact bet ID, source recommendation/message/event links, original market/selection, actual stake/price, settlement and provenance. Match only immutable IDs/exact unambiguous links. One event can have several tickets; event equality alone does not resolve market/selection/line ambiguity. Recommendations, suggested units and price gates never create actuals. Candidate reconciliation does not modify the ledger.
- P&L preview: use the shared existing deterministic settlement function only for supported won/lost/push/void with valid actual stake and executed American price. Match existing null and four-decimal rounding behavior. Unknown, contradictory, promotional, partial/cashout or unsupported settlement remains unknown. Preserve recorded profit alongside derived preview and flag disagreement rather than overwriting either.
- Unresolved tasks: missing official outcomes, conflicting facts, ambiguous identity/tickets, unsupported settlements, unavailable body sources and bounded-history limitations. These tasks must survive into Phase 2.

Fetch records linked to the scoped original reports/event IDs even beyond the generic recent 30 rows. Apply owner and sport constraints on every query. Use bounded pagination and emit explicit truncation/unavailable reasons when a cap is reached; do not label the packet complete. Preserve generic/ambiguous/historical-comparison scope behavior rather than guessing a date. Do not exclude older actual entries merely because their creation date differs from the event date.

## Phase 2: full deep review and result acquisition

Keep the existing single deep model call and its live-search capability. Dedicated review instructions replace unrelated new-pregame-candidate and current-market-evaluation machinery, while retaining source checks, distinction between historical judgment and outcome, full policy application, all-decision review, and uncertainty requirements. Never require a market-evaluation panel for review_results.

Pass Phase 1 plus original scoped decision bodies, policy, criteria and corrections. Review every decision, including winning errors, sound losses, justified passes and missed opportunities. Distinguish process error, execution discrepancy, new information and ordinary outcome variance; do not fabricate probabilities or infer poor process from a single loss. Search missing/unverified/conflicting outcomes and any causal evidence needed for the review. Stored facts guide retrieval and prevent repeated reconstruction but never authorize an unverified freshness claim.

No external sport-result adapter is implemented here. For an absent or insufficiently sourced stored result the existing live deep search is the actual acquisition path. If the provider cannot establish a result, retain it as unresolved and still review whatever original reasoning can be assessed. Do not describe all result lookup as off-model.

Review-only finalization preserves the original raw response, verified sources, checked time, usage and review audit without generating current recommendations or appending irrelevant full-slate coverage/extraction warnings. Keep all existing fresh-source verification gates and completion fencing. Result/note proposals remain prose, never automatic mutations. Existing non-review finalization is unchanged.

No new model-produced fact-block parser, independent result adapter or cross-job model-observation cache is part of this bounded implementation. Existing stored event/bet results are the reusable facts. Freshly researched observations remain traceable in the original response and sources; a later dedicated structured-capture feature would require separate source/identity validation work. Do not promise that unrecorded results become deterministic cache entries.

## Interfaces and ownership seam

Runtime owner owns `src/lib/analysis/results-review.ts` and its tests, plus `data.ts`, `context.ts`, `worker.ts` and related tests. Define a pure `prepareResultsReview` seam returning `{ context, packet }`, with dedicated review instructions selected separately. Keep the packet independent of database clients and retain safe fallback behavior for malformed input; no `extractResultsReviewFacts` interface is required. All packet row schemas retain source IDs/hashes, evidence class and explicit completeness status.

The independent helper owner owns `src/lib/records/settlement.ts`, `src/lib/analysis/review-usage.ts`, their tests, and the bet result route integration only. Settlement export: `calculateBetProfit(result: string, stake: unknown, price: unknown): number | null`. The usage helper provides numeric-only audit data to the runtime owner. Do not have both workers edit worker/data/context/gateway files.

## Reuse, recovery and idempotency

Each new review reuses the currently loaded, owner/sport-scoped stored result records and their original source/checked times. New contradictory results or missing/unverified provenance become search tasks. No metadata-only prior model observation is promoted into fact authority. Re-read actual records for a new job so changed actuals/results change the original-context byte digest; do not reuse an old packet merely because the event date matches.

The versioned packet carries the SHA-256 digest of the exact original context bytes. Changed actual price/stake/result, source revisions, or input ordering change that digest. This deliberately uses strict byte identity rather than an order-independent semantic cache: a reordered input is a different captured input, which safely prevents accidental reuse. The prepared context has its own existing snapshot hash. Persist before the deep call through the existing input snapshot. Transport retry uses that captured input. Completed-result recovery reuses the original input/instructions without another model call. A finalization retry cannot duplicate the assistant message or notes. No automatic result API calls, mistake-note writes, or adoption of new lessons.

The packet is recomputable preparation, not an independently scheduled job requiring a new stage table. A crash before completed provider evidence may still require the existing bounded fresh-generation retry; describe it truthfully. Reuse is bounded by available stored sources, not a claim of complete historical recall.

## Usage instrumentation

Capture UTF-8 bytes of original/prepared context and instructions, manifest/record counts, stored-result/unresolved fact counts, provider-reported input/output tokens, usage availability, attempt/transport identity, elapsed time and recovery status. Search/tool counts are not collected or emitted in this increment. An absent count means unknown, never zero. The existing searched boolean indicates search evidence, not the number of searches; do not infer counts from sources or streaming notifications. No search-count schema expansion is required. Record reported model/effort separately from requested values.

Gateway usage aggregates are not the initial prompt size. Preserve whether token fields were actually present; missing failed-attempt usage remains unknown. Do not estimate subscription percentage or dollar cost from tokens. Store new review telemetry in existing metadata/checkpoint-compatible optional result fields, not a strict diagnostics schema without updating its validator. Log numeric counters/hashes only, never raw private context, tickets or credentials.

## Verification and staged acceptance

Local mocked tests must cover all eight sports; PASS/WAIT/body-only coverage; older linked tickets; ambiguous identity; source conflicts; missing actuals; rounding; invalid result provenance/source timestamps; changed input digests; legacy fallback; required search; same requested model/effort; malformed input and unresolved facts; and checkpoint recovery without a new model call. Existing non-review context, chat, entry and result-route behavior must remain unchanged.

The implementation can use the dedicated path after local verification because it preserves the full evidence and model. Empirical quality and savings remain unmeasured until an explicitly authorized private paired comparison is run. No live paired run is authorized by this plan. Compare identical frozen cases including wins/losses/PASS/WAIT, missing facts, conflicting sources and special settlement. Acceptance: zero omitted review decisions, false actual entries, fabricated profits or lineage breaks; exact supported P&L parity; and no material loss in blinded review of causal evidence, counterarguments, uncertainty and lessons. Report token/search/latency distributions including failures/retries and missing telemetry. Roll back only the dedicated routing if material regressions emerge; retain stored evidence. Do not promise a savings percentage.
