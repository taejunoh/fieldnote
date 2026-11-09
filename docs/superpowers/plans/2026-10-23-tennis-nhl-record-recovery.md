# Tennis and NHL record recovery implementation plan

> **For agentic workers:** Use subagent-driven-development with independent spec and quality reviews. Do not stage, commit or create a PR: this checkout is ignored inside an unrelated parent repository.

**Goal:** Repair the two explicitly requested saved responses and expose their record recovery and source verification status in the latest analysis tables, preserving historical judgments and original evidence.

**Architecture:** Add a narrowly validated NHL recommendation-key normalization and a separately approved current tennis source-verification manifest. Extend the existing service-only completed-analysis repair RPC with matching TypeScript and SQL validation, then project trusted audit metadata into the latest-table API and UI. Do not rewrite original response content, original sources, timestamps, coverage, odds or judgments.

**Tech Stack:** Next.js/TypeScript, Vitest, Supabase PostgreSQL, existing Railway web/worker services.

## Verified execution outcome — 2026-10-23

- Independent specification, security and release-tooling review passed after correcting the NHL URL/ID binding and v2 recovery display compatibility.
- Integrated verification: 51 test files / 717 tests passed; lint, production build and subsequent serial TypeScript check passed. Actual-target SQL rollback fixtures and unchanged legacy v1 repair replays passed; actual post-SQL metadata passed the unmocked UI mapper.
- Applied only migration `202610230003_tennis_nhl_record_recovery.sql` (SHA256 `0a32a886b434cf77848ececb3c9bbd709b94ddf1ca50e1c26dda94640b0bbebd`). All four deployed function definitions matched local expectations, with service-only execution permissions.
- Normal web deployment `REDACTED-ID` and worker deployment `REDACTED-ID` each passed all 121 deployment-bound runtime hash checks. Web HTTP 200; gateway unchanged. No retry uploads or historical deployment fallback.
- Exactly one normal repair RPC per target restored tennis eight events / twenty judgments and NHL two events / thirteen judgments. Tennis retains separate current schedule-pair/date evidence; NHL has exactly one recommendation-key correction. Original raw responses, sources, check times, starts, judgments, policy and incomplete coverage remain unchanged.
- Authenticated per-sport and unified latest-analysis APIs returned HTTP 200, unchanged original tables/coverage and valid recovery DTOs. Temporary local owner session was logged out. An authenticated visual browser check was unavailable; UI projection was checked through rendering tests, real metadata and deployed APIs.
- Independent fresh readback preserved every previous betting, event, recommendation and note row. Counts: bets 107 unchanged; notes 154 unchanged; events 426 → 436; recommendations 478 → 511. Same seven original daily jobs completed on first attempt, same result messages, zero active jobs. No new analysis calls, actual bets, notes, paid API fallback or resources.
- Six original unknown tennis start times remain unknown. Additional verification does not certify original search membership, odds, actual first serve or complete schedule coverage. The original missing structured citation cannot be attributed conclusively to upstream versus bridge behavior; plain Markdown links are still not promoted into searched evidence.
- Private operational proofs are retained under the existing `source-coverage-repair-release-20261023-tennis-nhl` verification directory; no private ledger contents or credentials are recorded here.

## Confirmed facts and authority

- NHL job `REDACTED-ID`, message `REDACTED-ID`, raw SHA `2c2416f0eae86350d8425d0bd6298232727ee6a04214498ab1a9254623361671`: two raw events, thirteen recommendations. One orphan key on `chi_tt_1023` ends in official game ID `2026020166`, uniquely matching the original searched/cited official Gamecenter event. Both games were deferred; no BET or positive units exist.
- Tennis job `REDACTED-ID`, message `REDACTED-ID`, raw SHA `4f42583180bb523ca307e9a561d87a3573f2042e423a9fb69283aea586ebdeea`: eight raw events, twenty judgments; no BET or positive units. Four Cali URLs lack recoverable original structured search membership. Preserve this fact.
- Current public PDF verification confirms all eight pairs and ET dates, the two non-null original scheduled starts, and the six original null starts. Three PDFs were downloaded, text-extracted and visually checked, then root independently fetched identical bytes again. The original coverage remains 43 managed / one evaluated / twenty deferred / twenty-two excluded.
- Approved independent source manifest envelope SHA `839e83fe4de712b4eff3874a6797c2b26d491ce99a6c3b85ca4f4607058bee81`; canonical `manifest_json` SHA `ec37a6dcbe176dac4fdec9828b4fc5b0045ce8e52d77b3017ca6ed5e677798e2`. It records a new retrieval time up to `2026-10-23T17:08:14.691419+00:00`, explicitly excluding verification of original search membership, current odds, actual first serve or full coverage. Private envelope: `tennis-nhl-repair-20261023/approved-tennis-source-manifest-private.json` under the existing private verification directory.
- Add only `japanopentennis.com` and `protennislive.com` with existing exact apex/www policy. WTA's official notes link the tournament domain; an ATP-hosted report directly references the exact ProTennisLive host, and current PDFs are released event OOP documents. Do not claim ATP owns that host or treat branding alone as proof.
- Fresh root baseline at 17:01 UTC: 107 betting-ledger rows (including unconfirmed imports), 154 notes, 426 events, 478 recommendations; active owner jobs zero. Recheck and back up immediately before live changes.

## Task 1 — Backend normalization and source proof (worker A)

**Ownership:** `src/lib/analysis/record.ts`, `context.ts`, `completed-repair.ts`, small new normalization/proof helpers and their tests, the minimal integration in `worker.ts`, and NEW migration `supabase/migrations/202610230003_tennis_nhl_record_recovery.sql` plus focused SQL fixtures. Preserve all applied migrations and prior source changes.

- [ ] RED: reproduce exact NHL orphan rejection and tennis unofficial/unverified-source rejections using sanitized fixtures.
- [ ] Derive an explicit per-item correction `{reason:"unique_official_game_id",raw_sha256,item_key,from,to}` only for an NHL malformed key matching `^nhl:(\\d{4}-\\d{2})-(\\d{10})$`, a unique canonical same-month/scope-date event with that ID, exact official searched/cited Gamecenter ID evidence and consistent visible event identity. Reject ambiguity, valid-but-different keys, different sport/date/ID, missing source evidence, BET or positive units. Only `recommendation.event_key` may change. Preserve the raw response and persist correction provenance for future normal parsing and historical repair.
- [ ] Add the two exact tennis hosts and source guidance. Host permission alone must still reject the four missing original source memberships.
- [ ] Accept independent source evidence only as a separately supplied envelope `{version:1,manifest_json:string,manifest_sha256:string}`. Validate the plain UTF-8 JSON string digest, strict schema, target job/message/raw hash, original checked time, exact source URLs/eight event bindings/original starts, PDF metadata and new retrieval times. Pin the approved manifest digest and target identity in SQL and TypeScript; arbitrary caller self-attestation is insufficient.
- [ ] Export the approved digest and a server-safe proof parser for the UI mapper. Do not take independent evidence from model-authored raw JSON, append it to original `sources`, or label it as an original web search. Keep original coverage extraction/report unchanged. New proof authority is limited to non-actionable historical records with no BET or positive units.
- [ ] New repair fields are optional for legacy requests and must leave existing v1 derivation/fingerprint/idempotence unchanged. For new repairs, audit `recommendation_key_corrections`, `independent_source_verifications` (envelope array), `source_verified_at` (derived from approved PDF retrieval times) and `source_verification_scope:"schedule_pair_and_date"` inside the existing `completed_analysis_repairs` entry, identically across job/attempt/message. No source-URL or heading substitution.
- [ ] Mirror all reconstruction, authority and ambiguity checks in the new SQL migration; preserve service-role-only ACL and every unrelated sport/source rule. Keep the existing repair RPC signature, strict CAS, repeat no-op and conflicting-state rejection.
- [ ] GREEN: exact saved NHL derives two/thirteen with only one key changed; exact saved tennis plus the approved proof derives eight/twenty with original fields unchanged. Test altered raw/item/date/ID/source/pair/proof hash/body hash/time/manifest authority, cross-sport and actionability injection rejection. Run focused and full tests, lint, build and serial typecheck.

## Task 2 — Latest-table recovery display (worker B)

**Ownership:** new API-side recovery metadata mapper and tests, latest-analysis table DTO/types, both latest-analysis route families and tests, minimal shared recovery-status UI component and its sport/overview/modal integration. Do not edit backend-owned worker/normalizer/SQL files.

The optional API DTO is:

```ts
type RecordRecovery = {
  status: "repaired";
  originalCheckedAt: string | null;
  repairedAt: string;
  sourceVerifiedAt: string | null;
  sourceVerificationScope: "schedule_pair_and_date" | null;
  eventCount: number;
  recommendationCount: number;
};
```

- [ ] RED: valid trusted repair audit projects this DTO; incomplete/missing/forged/mismatched audit metadata does not produce a success indicator. Existing unrelated analysis responses stay compatible.
- [ ] Derive DTO only from a complete persisted record and a structurally valid matching audit/raw digest and counts. A tennis additional-verification indicator also requires the approved manifest digest, its matching original raw/target identity, and its derived source time; never trust a model-authored `verified:true` field.
- [ ] Show a compact Korean status such as “분석 기록 반영 완료”, original analysis check time and separately “일정·대진 추가 확인” when present. Reuse current typography/spacing in sport table, overview and expanded table. Preserve historical Markdown rows and the original incomplete coverage badge. Do not imply odds, actual starts or full-slate verification.
- [ ] Verify API and rendering states, invalid-metadata fallback, missing-time formatting, mobile width and no node-only code in browser bundles. Run relevant tests and integration build/typecheck.

## Task 3 — Bounded source diagnostics

- [ ] Retain the established structured-citation/action-source contract; never promote plain model Markdown links into searched sources. Add only bounded diagnostics or regression coverage necessary to make the actual missing-source failure explicit. Distinguish known downstream preservation from the unresolved upstream-versus-bridge origin of this historical gap.
- [ ] Any new diagnostics must be capped counts/channel URL hashes, with no raw search queries, private response bodies, secrets or query/fragment text. Coordinate `worker.ts` ownership through worker A; avoid gateway deployment unless a concrete bridge bug is proven.

## Task 4 — Reviewed release and exact replay

- [ ] Independently review spec compliance, then code quality/security and current source-proof authority. Freeze final source, migration, manifest and request hashes.
- [ ] Run both actual targets in local SQL BEGIN/ROLLBACK, including exact reconstructed records, non-actionable judgments, all raw/body/policy/coverage/time fields, correction/proof audits, legacy repair compatibility, idempotent repeat, stale/full-row/compact-CAS conflicts and protected ledger preservation.
- [ ] Prepare one compact guarded migration request and frozen web/worker contexts, preserving prior runtime rollback images. Use server-canonical row digests from the same read-only query as the full original rows; compare every row with immutable snapshots. Do not embed multi-megabyte snapshots in management API requests.
- [ ] Only after fresh owner active count zero and full-row baseline, root may authorize the reviewed migration and one web/worker upload each on existing resources. Verify helper/RPC definitions and ACL, actual deployment-bound runtime hashes and public health. Stop on ambiguous results and read back before any repeat. No historical fallback without a separately reviewed root gate.
- [ ] Execute exactly one normal repair RPC per approved target after fresh CAS/idle checks. Confirm tennis eight/twenty and NHL two/thirteen, exact sources/keys/units/gates/time/provenance and one audit each. Do not add model calls, real bets, notes, results or policy changes.
- [ ] Verify authenticated per-sport and unified latest-analysis API recovery DTOs and unchanged original tables/coverage; inspect the visible UI when an authenticated session is available. Compare every pre-existing ledger/event/recommendation/note row, all original messages and input snapshots, and zero extra analysis jobs. Report separately any remaining uncertainty.
