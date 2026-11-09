# Soccer official club source repair — 2026-10-21

## Goal and scope

Finish today's already authorized analysis by restoring the soccer event/recommendation records rejected solely by the official-host allowlist. Do not generate another analysis or change original conclusions. The current operational run has seven initial analyses plus one explicitly disclosed CFB scope correction.

Target completed job: `REDACTED-ID`.

Original response SHA256: `3dbb334af3c38e2d46cb3bc6d25ccbf1256bf7349199ae1be1f3df21343e2fc4`.

## Evidence and limits

- [x] Diagnosis: five raw events and eleven recommendations fail `unofficial_source`; all five URLs were searched, visibly cited, and uniquely linked to their original inventory key and URL.
- [x] MLS's D.C. United page and Leagues Cup's Atlas, Puebla, Pachuca, and Santos pages link directly to the five official club sites.
- [x] An in-memory exact-host-only replay derives the original five events and eleven recommendations with original time, policy, key hashes and units. No citation supplements, heading changes or key corrections are needed.
- [x] Static review finds the existing service-only repair RPC compatible with this target; runtime validation remains a release gate.

Exact observed hosts: `www.dcunited.com`, `www.atlasfc.com.mx`, `www.clubpuebla.com`, `tuzos.com.mx`, `www.clubsantos.mx`. Preserve existing registered-domain apex/www normalization, reject arbitrary subdomains and lookalikes. Do not build a new source registry or expand unrelated source policy in this change.

Official domain identity evidence is separate from current match factual revalidation. Some article URLs could not be reopened by the external browser. Preserve original searched sources and check times, and retain the genuine incomplete coverage: 26 listed / 26 processed, with independent schedule verification unavailable and other original limitations.

Safe diagnosis receipt SHA256: `a78d0f7743029103dd2ee847a6f5866dc3d2a6545d26285c2e4620e1afd70682`. Private snapshots and evidence remain outside the repository with mode 0600.

## Implementation ownership and gates

- [x] Source implementer: narrowly update `record.ts`, source guidance in `context.ts`, focused tests, and new migration `202610210001_official_soccer_club_sources.sql` replacing only the shared source predicate.
- [x] Demonstrate RED then GREEN for the five source hosts. Retain searched/cited requirements, deterministic original-URL key hashes, URL shape checks, cross-sport rejection and atomic mixed-record rejection. Verify TS/SQL parity.
- [x] Run focused SQL rollback tests, full TypeScript tests, lint, typecheck and production build. Review the final frozen diff and official evidence independently.
- [x] Release operator: prepare exact-one-target dry-run/apply scripts using the existing generic repair helper and RPC. Do not run the old CLI unchanged: its two jobs and date are hardcoded for October 20.
- [x] Test the actual target in local SQL BEGIN/ROLLBACK, including original-field preservation, historical timestamps, unique provenance, identical repeat no-op and stale/conflicting-state rejection.
- [x] Freeze allowlisted web and worker contexts; exclude credentials and all private verification material. Preserve rollback manifests/images and the unchanged gateway.
- [ ] Only after all eight analysis jobs finish and a fresh owner active-job count is zero, back up the exact target and helper definition, apply only the reviewed new migration, and deploy web/worker on the existing Hobby resources. No historical migration rewrites, plan upgrades or new resources.
- [ ] Verify runtime hashes and health. Recheck exact target CAS, then apply the one reviewed repair once. An ambiguous network response requires readback before any repeat.
- [x] Independently verify five events / eleven recommendations, unchanged original body/raw/input/sources/check time/completion timestamps and coverage, one assistant result and repair audit, no extra bets or notes, and no duplicate recommendation keys.

## Preserved operational boundaries

No paid OpenAI fallback, extra model analysis, automatic betting, criteria adoption, original judgment rewriting, gateway deployment, Git staging/commit/PR, or public posting. Worker deployment while analysis jobs are active is forbidden. Baseline actual bets: 107; notes: 152.

The broader 21-competition source catalog remains a future concern; accepting a new unverified club domain is not part of this repair.

## Pre-release verification observed by root

- Full test suite: 46 files / 623 tests passed; lint, TypeScript no-emit and production build each exited 0.
- Independent review found no blockers for the explicitly approved five registered domains with existing apex/www handling. Coverage warnings are separate exact searched-URL membership checks and remain unchanged.
- Frozen manifest SHA256: `f14dc77d0cc913a4443217fd456f19ec1e2fb7724f486ba217c89867a9a81cdf` (234 files; 117 each web/worker; gateway excluded).
- Actual-target SQL rollback v2 receipt SHA256: `f52a2e212c128d4a26261a48d9508d8ce1129b9a5d4b5dd2cfe250e3c60a572e`; PASS with rollback. Root independently checked receipt hashes and final production source hashes.
- At this gate, CFB scope correction remains active; deployment and production repair have not been applied.

## Approved release gate amendment — platform outage

Railway rejected the web upload before deployment with `UPLOAD_FAILED: Deploys have been paused temporarily`. Its official status page confirms the October 21 platform outage and OAuth session invalidation. The reviewed SQL helper was already atomically applied and its canonical definition/ACL read back; no new web/worker deployment occurred and no repair ran under the original deployment gate.

Root approved a separately reviewed exact-one historical repair, rather than marking the deferred runtime rollout verified. Existing readers retrieve persisted records and do not re-run source extraction. The ten relevant reader/worker/derive files match the prior actual runtime attestation and the original deployment/image IDs remain retained; independent fresh SSH checks failed, so there is no fresh runtime file-hash claim.

Separate gate requires explicit root historical approval, `runtime_rollout_state=deferred_platform_outage`, live DB readback receipt binding, approved original target/raw/request hashes, retained three known deployment IDs SUCCESS/RUNNING, fresh owner active count zero and whole-row CAS immediately before the single generic repair RPC. Ambiguous responses require readback. Preserve all original fields, coverage, ledger rows and provenance.

Reviewed private proposal SHA256: `057a9c78adcfaadfe731c4dc82da36dd2474427f5bac21f0402201af40be198a`. Reviewed repair request SHA256: `ec681f737dab97c5e60928936b6a9a0f86e8e83123d019f4206771622baad49b`. Applied helper canonical SHA256: `d8bf6e3eb629114e7438af3c8bf9d9e4a61bafb486674ba42b63cafafc81609a`.

Future TS source-guidance/predicate deployment remains pending external Railway recovery. No new resources, upgrades, paid API/model calls or blind deployment retries are authorized by this amendment.

## Production outcome

- All eight approved daily jobs (initial seven sports plus explicit FBS/FCS CFB scope correction) completed at attempt 1 with linked assistant results. Root independently confirmed active owner jobs zero before release.
- Applied only `202610210001_official_soccer_club_sources.sql`; canonical helper definition and unchanged service-only ACL were read back.
- Railway blocked the first web upload before a deployment was created. No worker/gateway deployment or blind retry occurred; prior successful runtime IDs remain retained. Runtime source/prompt rollout is **pending platform recovery**, not verified complete.
- Under the independently reviewed separate historical gate, the existing generic repair RPC ran once for the exact saved soccer result and returned `repaired`.
- Root independent REST checks: all five original event keys persisted with original source URLs and starts_at; eleven unique recommendation item keys link to the original assistant and historical created_at. Three events have recommendations and two do not, as in the saved record. Exactly one assistant and repair audit; original raw SHA, body, job/attempt/message fields and protected metadata unchanged. Original coverage/report remains 26 listed / 26 assessed, incomplete.
- Root compared every current bet and mistake-note row with the pre-write backup: 107 bets and 152 notes exactly unchanged. Operator additionally checked all pre-existing event/recommendation rows unchanged.
- Authenticated latest-analysis API exposes the repaired soccer job with unchanged incomplete coverage. Public page GET returned 200. Do not equate the API JSON observation with an independently observed HTTP status.
- Identical repair no-op and drift rejection are proven by actual local SQL rollback tests. No unnecessary production repeat was performed. No additional model calls, paid fallback, resource/plan changes or actual bets were created for the repair.
