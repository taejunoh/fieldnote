# CFB official school source repair implementation plan

> **For agentic workers:** Use subagent-driven-development for implementation and independent review. No Git staging or commits: this checkout is ignored inside an unrelated parent repository.

**Goal:** Persist today's saved CFB analysis, seven events and twenty recommendations, rejected only because verified official school athletics hosts are absent from the source predicate.

**Architecture:** Extend the existing exact apex/www host policy in TypeScript and its SQL equivalent. Replay the unchanged saved response through the existing service-only completed-analysis repair RPC after all current jobs finish; retain original source URLs, keys, timestamps, policy and coverage limitations.

**Tech Stack:** Next.js, TypeScript, Vitest, Supabase PostgreSQL, existing Railway Hobby web/worker.

## Evidence and boundaries

- Target job `REDACTED-ID`, result `REDACTED-ID`.
- Verified university athletics links identify `dsuhornets.com`, `virginiasports.com`, `uconnhuskies.com`, `pennathletics.com`, `tulsahurricane.com`, `goairforcefalcons.com`, `gostanford.com` as official sites. Preserve existing apex/www normalization only.
- Exact private URLs, searched/cited membership, original timestamps and full-row backups remain outside the repository with restrictive permissions.
- Preserve the pending October 21 soccer source changes. No source substitution, response rewrite, broader wildcard, new model call, paid fallback, actual bet, note, policy adoption, gateway change or resource upgrade.
- The current CFB response covers seven scheduled games but evaluates only two and defers five. Repair must retain incomplete coverage.

## Task 1: Predicate, prompt guidance and regression tests

**Files:** `src/lib/analysis/record.ts`, `src/lib/analysis/context.ts`, their existing focused tests; create `supabase/migrations/202610230001_official_cfb_school_sources.sql` and `supabase/tests/cfb_official_school_sources.sql`.

- [x] Add parameterized regression tests for the seven observed hosts and existing apex/www variants; run focused tests and confirm the current `unofficial_source` rejection.
- [x] Add only these registered domains to the CFB predicate and official-source guidance. Preserve searched/cited URL membership and original-URL key derivation.
- [x] Copy the current shared SQL predicate into the new migration with only the CFB branch expanded; preserve service-role ACL and every other sport.
- [x] Verify accepted HTTPS default-port URLs and rejected HTTP, userinfo, nondefault port, arbitrary subdomain, lookalike, unsearched/uncited URL, cross-sport and mixed invalid record cases, including SQL parity.
- [x] Run focused tests, full `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`. Review spec compliance before independent code-quality review.

## Task 2: Prepare exact historical replay and release

- [x] Adapt the audited October 21 private repair tooling for exactly this job and saved result; derive seven events and twenty recommendations without changing raw text or source keys. Freeze source/request hashes.
- [x] Run the actual target through local PostgreSQL BEGIN/ROLLBACK; prove original-field preservation, deterministic provenance, repeat no-op, and stale/conflicting-state rejection.
- [x] Freeze reviewed web/worker contexts and rollback receipts, excluding private data and secrets. Do not upload or mutate live SQL while jobs remain active.
- [x] Once all seven jobs are terminal, obtain a fresh owner active-job count of zero and full-row backup. Apply only the reviewed new source helper migration and verify definition/ACL readback.
- [x] Deploy reviewed web/worker contexts on existing resources if Railway permits. Never describe deferred deployment or failed SSH as verified rollout. If a platform outage persists, independently review a separate historical-repair gate using the retained compatible runtimes.
- [x] Apply one exact-target CAS-guarded repair RPC. For ambiguous responses, read back before considering repetition.

## Task 3: Independent completion proof

- [x] Confirm original seven events and twenty unique recommendations link to the original result and job, retaining original checked/completion times, source URLs, keys, units, body/raw and incomplete coverage.
- [x] Compare every existing bet, note, recommendation and pre-existing event row against its appropriate pre-write baseline. Confirm one result and repair audit, no extra model jobs.
- [x] Verify authenticated latest-analysis retrieval and public app health. Report analysis completion, coverage limits, persistence recovery and deployment state separately.

## Scope amendment: Soccer's second observed source rejection

Soccer job `REDACTED-ID`, result `REDACTED-ID`, has eight raw events and three PASS recommendations rejected by the same predicate. This is not a no-games result. Preserve its incomplete coverage, two evaluated games and six deferred games.

Primary DFL/LALIGA, Lega Serie A, UEFA directory and NWSL team-directory evidence identifies exactly seven additional registered domains: `bundesliga.com`, `laliga.com`, `acmonza.com`, `ogcnice.com`, `chicagostars.com`, `reignfc.com`, `thorns.com`. Identity evidence remains private; searched/cited membership and original source-key bindings require independent verification before replay.

- [x] Add focused RED/GREEN tests and only these seven soccer apex/www domains to `record.ts` and `context.ts`, preserving every CFB and previous soccer source change.
- [x] Create `supabase/migrations/202610230002_official_soccer_league_club_sources.sql` from the reviewed CFB helper with only the soccer branch extended; create `supabase/tests/soccer_official_league_club_sources.sql`. Keep the earlier CFB migration and receipts immutable.
- [x] Verify the same URL-shape, citation/search membership, cross-sport and atomic rejection boundaries. Run both sports' SQL fixtures, TS/SQL parity, full tests, lint, typecheck and build; independently review spec then code quality.
- [x] Supersede the CFB-only release candidate with one combined helper migration and one web/worker rollout. Independently review exact two-target replay, local rollback, fresh idle baseline and all final frozen hashes. No live apply until all seven analysis jobs are terminal and owner active count is zero.
- [x] Restore CFB and soccer from their original saved responses through separately guarded existing repair RPCs, without new model calls or source/body/time/policy rewrites. Preserve original incomplete coverage and audit the two results independently.

## Other completed responses: preserve unresolved extraction limits

- Tennis returned eight raw events and twenty judgments. Four Cali URLs have no recoverable original searched-source membership in the saved attempt, message, job or captured trace. Preserve its raw response and incomplete coverage; do not manufacture membership, substitute sources or replay the unverified record. Its inventory contains 43 items: one evaluated, twenty deferred, twenty-two excluded. Estimated start times describe the stated scan time rather than the current live state.
- NHL returned two raw events and thirteen judgments. One recommendation references a malformed event key. The existing repair mechanism does not authorize recommendation-key rewriting, so preserve the original response and structured-incomplete state. Both games remain deferred; no BET recommendation was made.
- Neither response is a target of this two-result repair. All seven model jobs completed on their initial attempt, with one transport attempt each and no recovery or extra model calls.

## Release amendment: compact original-row CAS

The first migration request was rejected with HTTP 413 before PostgreSQL execution because its embedded original snapshots made the request about 4.7 MB. Independent readback confirmed the old helper and ACL unchanged; no upload or repair followed that rejection.

The reviewed versioned replacement is 5,636 bytes. A single read-only PostgreSQL query returns six original full rows and their server-canonical SHA256 digests together. Type-sensitive comparison binds every returned row to its immutable diagnosis snapshot. The compact apply retains the same six locked-row comparisons via canonical digests, owner-idle and seven-terminal-job checks, prior-helper digest, exact final migration, and unchanged ACL. A fresh full idle baseline under 120 seconds old is required at apply. Local rollback proves six original full-row and six compact stale-row rejections, original row acceptance and protected ledger preservation.

Original release artifacts and the failed request/readback receipts remain immutable. The final source migration is `202610230002_official_soccer_league_club_sources.sql`; neither historical migration repair nor an unrestricted SQL push is authorized.


## Verified production outcome — 2026-10-23 14:35 UTC

- Applied only the final combined helper migration002 with compact original-row CAS; canonical helper digest and service-only ACL matched the reviewed version. The rejected full-snapshot request had no database effect.
- Web deployment `REDACTED-ID` and worker deployment `REDACTED-ID` each matched all 112 frozen runtime file hashes. Web returned HTTP 200. Gateway remained unchanged.
- The normal existing repair RPC ran exactly once per approved target: CFB seven events/twenty recommendations and soccer eight events/three recommendations. No historical fallback path was used. Original bodies, raw responses, sources, check/completion times, policy, decisions, units, gates and incomplete coverage were preserved. Each repair has one audit record.
- Authenticated per-sport and unified latest-analysis endpoints exposed the original result IDs and tables with unchanged incomplete coverage; the temporary local session was logged out. This is API verification, not a browser screenshot observation.
- Independent operator, quality and root checks confirmed seven authorized initial jobs only, all completed on attempt one, and zero active owner jobs. Final totals: 107 betting-ledger rows (including imported unconfirmed entries), 154 notes, 426 events and 478 recommendations. Every original 107/154/410/445 row remained unchanged. No actual bet, note, additional model job, transport retry, paid fallback or hosting resource/plan change was created.
- Tennis and NHL retain their original completed responses and structured-incomplete states for the documented provenance/key issues. Coverage and deferred/excluded counts remain visible; full-slate evaluation is not asserted.
- Private final verification: `all-sports-today-20261023-root-final-verification-private.json`, post-repair full-row/source/snapshot receipts, independent final-quality receipts and combined normal-release operational proof. No private ledger or credentials were copied into this repository.
