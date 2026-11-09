# Official source classification and saved analysis recovery

**Goal:** Accept the four independently verified official federation, club and tournament hosts, then recover the three saved October 26 analyses without another model call.

**Architecture:** Keep the existing exact apex/www, per-sport allowlist and searched/cited URL checks. Update both the TypeScript predicate and SQL helper. Use the existing service-only `official-source-coverage-v1` completed-analysis repair, which derives judgments from immutable original responses and evaluates historical recommendation timing against the original check time. Do not extend the separate v2 independent-source exception.

**Scope:** `federacaopr.com.br` and `atletico.com.br` for soccer; `philadelphiaeagles.com` for NFL; `toray-ppo.com` for tennis. Original URLs already occur in both saved search sources and visible citations. A single rejected event currently rejects the entire record atomically; preserve that protection.

This checkout is ignored inside an unrelated parent repository. Do not stage, commit or modify that parent. User authorization covers this repair and production application on existing resources; no plan upgrade, new resource, model request or paid API fallback.

## Implementation and regression proof

- [x] Add regression cases that fail with `unofficial_source` before the fix, including soccer's second event source.
- [x] Add the four exact domains to `record.ts` and source guidance in `context.ts`; add a versioned SQL helper migration with the same accepted hosts and unchanged service-only ACL.
- [x] Retain rejection of lookalikes, arbitrary subdomains, HTTP, credentials, nondefault ports, cross-sport URLs and absent original search/citation membership. Preserve original URL-derived event keys.
- [x] Run focused Vitest tests, all tests, lint, TypeScript, build and SQL regression/parity checks. Independently review the diff and SQL helper.

## Guarded historical recovery

- [x] Freeze private full-row snapshots and exact raw-response/request/repair hashes for jobs `REDACTED-ID`, `REDACTED-ID`, `REDACTED-ID`.
- [x] Derive existing v1 repairs: soccer two events/seven recommendations; NFL one/thirteen; tennis two/four. Preserve all original decisions, units, gates, source URLs, checked/completion times, input policy and coverage limitations.
- [x] Run the exact repairs in a local transaction with rollback; prove repeat no-op, stale snapshot rejection, original provenance preservation and no actual betting-ledger changes.
- [x] Review frozen deployment/migration/recovery artifacts before applying. Require a fresh owner-idle check and current full-row baseline. Apply only the new SQL helper and release reviewed web/worker files to existing services; gateway unchanged.
- [x] Execute exactly three CAS-guarded original-response repairs. Read back ambiguous outcomes before repeating anything. Keep repair timestamps separate from original judgments.

## Completion proof

- [x] Confirm five recovered events and twenty-four recommendations link to the original three results, with one repair audit each and idempotent repeat behavior.
- [x] Compare all pre-existing event/recommendation/bet/note rows and policy/source content against the fresh baseline. No old judgment or actual game state may change.
- [x] Verify authenticated conversation/latest-analysis API and recovery DTOs for all three sports; logout and clear the temporary session.
- [x] Report the production rollout and recovered records separately from incomplete original market evaluation. Do not present October 26 recommendations as current October 27 bets or retrospective predictions.

## Verified production outcome — October 27, 2026

- Web `REDACTED-ID` and worker `REDACTED-ID` are running; all 121 runtime files per service match the reviewed packages. Gateway unchanged.
- Source helper updated, existing repair RPC and service-only ACL unchanged. Eight independent production source-predicate checks passed.
- Three original-response repairs restored soccer 2/7, NFL 1/13, tennis 2/4. Seven authenticated sport endpoints returned HTTP 200; all three recovery DTOs distinguish October 26 judgments from October 27 repair time.
- Final ledger: 107 bets, 157 notes, 468 events, 609 recommendations. All previous rows and original sources, responses, policies and coverage limitations are unchanged. No new model requests, actual bets, notes, results, resource or plan changes.
- Full test suite: 732 passing; focused independent verification: 131 passing. Lint, typecheck, build and actual-target SQL rollback tests passed.
- Private final operational proof SHA256 `09210230b7258f694d0ae693a2a87b0818b98e408b0b2e5a8eb28fc150c9cb3b`; independent root live proof `711eacc7700c4e8e1584cbddac094a56a49c276aa6dbfe8edf016b274bd3d429`.
