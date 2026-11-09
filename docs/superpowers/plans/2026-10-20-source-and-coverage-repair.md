# Official source and coverage repair implementation plan

> **For agentic workers:** Use subagent-driven-development. Root assigns disjoint ownership, verifies results and performs release gates. Preserve other agents' work; do not commit or force-add files in the unrelated parent repository.

**Goal:** Accept two evidenced official source hosts, eliminate false tennis coverage omissions, and repair the two already saved Oct 20 results without new model calls, duplicate messages, invented analysis, or bets.

**Architecture:** Keep existing extraction and finalization trust gates, adding exact source aliases in TS and SQL. Coverage matching may recognize a tournament heading plus the exact pair and unique explicit ID in the same row. A service-only transactional repair path reprocesses immutable saved output and records corrections separately from original model output and original extraction failures.

**Tech Stack:** Next.js/TypeScript, Vitest, Supabase Postgres and existing Railway Hobby worker.

## Evidence and scope

- NHL official article host `frontend.d3.nhle.com` and WTA official draw host `wtafiles.wtatennis.com` are currently rejected by exact-host rules despite being searched and cited. Official cross-links/canonical evidence was inspected read-only.
- Latest analysis tables already derive from message content; source rejection blocks structured event/recommendation persistence, not the latest-table renderer.
- Tennis contains all 101 inventory rows. Fifty-seven false body-missing warnings arise from tournament headings separated from participant rows. IDs in body rows are uppercase, while inventory key suffixes are lowercase; labels use a space after the tournament rather than an em dash. One assessment uses `ten:<short-id>` instead of the corresponding full inventory key. Unique ID, pair and tournament corroborate that single correction.
- Correct production-order replay also finds two NHL event URLs absent from original visible body citations. They have exact event-key/label/URL bindings in original record and coverage inventory plus gateway sources, with no equivalent visible canonical URL. Full repair must add an explicit visible, audited citation supplement, never count hidden control JSON as a body citation. Direct extraction of the unstripped raw response is not sufficient replay evidence.
- Dispositions remain 2 evaluated, 5 deferred, 94 excluded. `inventory_complete=false` and absence of independent schedule validation remain genuine limitations. Never describe 101 processed entries as 101 evaluated matches.

## Task 1 — exact source aliases

**Ownership:** Source implementer: `src/lib/analysis/record.ts`, its tests, source/key output instructions in `src/lib/analysis/context.ts` and focused tests, `supabase/migrations/202610200002_official_event_source_hosts.sql`, focused SQL tests.

- [x] RED: searched and cited exact alias URLs with `:src` keys should extract and hash the original URL correctly. Existing code rejects each with `unofficial_source`.
- [x] GREEN: add only the exact two aliases; keep original URLs and deterministic sourced keys. Do not implicitly accept `www.<alias>`, arbitrary subdomains, suffix lookalikes, userinfo, non-HTTPS, nondefault ports, unrelated sports, unsearched/uncited URLs or invalid mixed records. Preserve the existing URL normalizer's treatment of default HTTPS port 443 in both TS and SQL.
- [x] Mirror identical source policy in SQL finalization; expose a small SQL source predicate for the repair transaction to reuse. Preserve finalization leases, policy/BET/time/unit checks and all-or-nothing validation.
- [x] Update output guidance to use supported official URLs and copy complete inventory event keys unchanged into assessments.
- [x] Run focused TS and SQL source regressions, including no bet inserts and idempotent recommendation keys.

## Task 2 — conservative body matching

**Ownership:** Coverage implementer: `src/lib/analysis/coverage.ts`, `coverage.test.ts`; do not edit context instructions owned by task 1.

- [x] RED: a tournament heading plus a same-row unique explicit ID and exact participant pair must match; the old flattened full-label check fails.
- [x] GREEN: retain exact full-label recognition and add the corroborated section/row form. Wrong tournament, missing row, missing/duplicate ID, mismatching pair and ambiguous references remain missing. No fuzzy event-key correction.
- [x] Keep orphan assessment keys invalid until an explicit audited repair. Confirm the generic matcher removes 46 false warnings; the remaining 11 name-expansion cases require the separately approved historical heading overlay. The original key typo and genuine completeness limitations remain visible until audited repair.
- [x] Test disposition counts/independent-validation limitations without changing the meaning of `evaluated`, `deferred`, `excluded` or completion.

## Task 3 — repair already completed results

**Ownership:** Repair implementer after contract review: `scripts/repair-completed-analysis.ts`, dedicated repair helper/tests if needed, `supabase/migrations/202610200003_repair_completed_analysis.sql`, focused SQL repair tests.

- [x] Build a dry-run-first script which derives extraction/coverage from the saved original response, searched sources, original checked time and original attempt policy. Preserve raw/source references. No model requests.
- [x] Add a service-role-only transaction which locks and checks the completed job, completed current attempt and exact linked assistant result. Require expected original metadata equality and attempt identity so stale requests fail before writes.
- [x] Validate all records with the same source/key/price/unit/time/policy gates. Preserve existing event judgments and reject conflicting existing recommendation items. Insert missing records with existing unique keys, never actual bets, event results or new messages.
- [x] Append a repair audit retaining original failure metadata and original hashes, checking idempotence on repeat. Preserve original content/raw/input/checked time/completion timestamps and historical ordering.
- [x] For the one proven tennis key typo only, require unique inventory ID + exact pair + tournament evidence. Store the original report and correction audit; recompute coverage from the corrected report. Do not claim independently complete coverage.
- [x] For each genuinely missing NHL body citation, derive a `repair_citation_supplements` entry only from exact original record-to-inventory identity, the same official source URL and searched sources. Bind supplement and audit to immutable raw response; reject substitutions, unbound entries and drift. Run the unchanged strict extractor against the original visible body plus the exact supplement that the UI displays. Preserve original content and original failure history.
- [x] Display this typed supplement under the saved assistant response as **기록 복구 출처 보완**. Its fields are `event_key`, `label`, `source_url` and fixed reason `original_inventory_citation`. Never import server-only crypto code into the client or render arbitrary protocols/HTML. Omit when empty.
- [x] SQL rollback tests: successful repair once, identical repeat no-op, stale metadata/attempt/link rejected, conflicting existing record rejected atomically, original judgments preserved, no bets/results/messages added.

## Task 4 — combined replay and production verification

- [x] Replay the two exact saved responses privately with the new TS code: expected NHL 11 events/20 recommendations and tennis 2 events/4 recommendations, or investigate any additional rejection before shipping. Keep all private results outside the repository.
- [x] Run full `npm test`, typecheck, lint and production build. Run new SQL tests and relevant existing finalizer/policy/coverage cases; report preexisting failures explicitly.
- [x] Independent review of source trust parity, coverage identity matching, repair authorization/idempotence/time/provenance and ledger invariants.
- [x] Back up function definitions and the exact two job/message metadata snapshots privately. Apply reviewed migrations atomically through established authorized database access; do not blindly push historical migrations.
- [x] Deploy only changed runtime services from a frozen allowlisted context on Hobby; verify runtime hashes and health. Do not upload credentials, upgrade plans or change paid fallback.
- [x] Dry-run then repair the two exact completed jobs once. Independently read back structured counts, unique messages/recommendations, coverage reasons/disposition counts, repair audit and unchanged original timestamps/content/raw/attempts/bet/result rows.
- [x] Verify current latest-analysis API renders updated metadata and existing body. Report successful repairs separately from genuine remaining scope/independent-validation limitations.

No new model calls or paid resources are required by this plan. If a new factual analysis is later found necessary, report the specific missing evidence and proposed bounded subscription usage before executing it.

## Verified local release evidence

- Root full suite: 46 files / 609 tests passed; lint, typecheck and production build passed. Package, lockfile and Next configuration are unchanged from the previous verified deployment.
- Independent reviewer: 122 focused tests plus explicit hidden-code, swapped-row and private-receipt path rejection; no blocking findings in frozen code.
- Actual two saved requests passed local SQL rollback with current migration SHA `d6ce260ff7c6b4d4bb6573dfb41b1a6beffccc723d9f8a61db5cc8aec9aebecc`. Receipt SHA `16a2edcf9a0821c1734c17ffae04842600bdf5ad51dc8d6996d6b840fab250cc`.
- Root-approved heading plan SHA `3c6e90fbced365bd5fe9c393301c79b4f0127556a8c90d604a73e2765d063e93` is bound to exact original raw, one heading and 11 visible identity rows. Official ATP evidence was read via its search index; the evidence receipt SHA `4885cb658cdab253ffccbd5c5f86d0abe4d99407a5d531eba26cb7efa139eecc` is not an authenticated HTML capture. This is an explicitly reviewed operator correction.
- Production migrations 002/003 applied atomically after idle/CAS/backup gates, without migration-history rewrites. A verification-wrapper alias collision initially caused a full rollback; the corrected wrapper passed rollback-only checks before the successful apply. Reviewed migration source hashes remained unchanged.
- Frozen web/worker context manifest SHA `c1b86651c83f160fe546c4a617fcf925a4fe475c3ae4ede47e52a3f2c172367e`; root independently verified all 234 staged file hashes. Gateway excluded.
- Web deployment `5a268039-99cb-461b-a246-709aa5d01675` and worker `d99a0624-5f35-48ad-81ba-5b7bc88f5788` are successful, each with 112 runtime files matching the frozen manifest. Public web GET returned 200. Gateway `e43bf7bd-69ef-489d-a323-f38af30a4c1d` is unchanged.
- The approved CLI ran once: both repair RPCs returned `repaired`. Apply receipt SHA `a63861b1637b5f32c415454aa31ee386145d79fae2deadb68af4b7d6c3719545`. No new model requests were sent.
- Root independent REST readback verified all nonderived job/attempt/message fields and protected metadata unchanged, plus every preexisting 107 bet / 388 event / 378 recommendation row unchanged. Exactly 13 events and 24 recommendations were added; no bets or assistant messages were added. Each result has one repair audit and unique recommendation keys. Root receipt SHA `cf8818e06444aaa808b33a8bcf96bd9580ae413692e38d14630288c37a9e4ac0`. Separate Management API repeatable-read verification also passed, receipt SHA `c46c33303285a58d801158da0943e917b62ac91f676162b2c11afcef6a1291c7`.
- Production Chrome UI after refresh: tennis displays 101 listed / 101 processed, original 18:03 ET creation time, and incomplete coverage; NHL displays 11 / 11, original 18:00 ET creation time, and unverified coverage. NHL assistant response renders one visible **기록 복구 출처 보완** footer with two HTTPS `www.nhl.com` links and the explicit repair notice. This verifies authenticated latest-analysis rendering; individual owner API HTTP statuses were not separately observed or inferred.
- Tennis remains 2 evaluated / 5 deferred / 94 excluded; no missing inventory keys or false body-missing reasons remain. The original declared-incomplete inventory and unavailable independent schedule verification remain visible limitations.
