# CFB and Conditional Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. User instructions prohibit commits, pushes, and remote creation.

**Goal:** Correct CFB source classification and show original non-exact-time recommendations as clearly conditional display rows without weakening persisted BET eligibility.

**Architecture:** Separate candidate JSON and a private audited legacy overlay feed the existing owner-scoped latest-analysis projection. Existing analysis-record persistence stays strict. CFB host validation changes in TypeScript and SQL together.

**Tech Stack:** Next.js/TypeScript, Zod, Vitest, PostgreSQL/Supabase, private server-side JSON.

**Workspace:** `<Fieldnote workspace>` only. The approved contract is in `docs/superpowers/specs/2026-10-27-cfb-conditional-display-design.md`.

## Task 1 — CFB exact source acceptance (CFB worker)

Files: `src/lib/analysis/record.ts`, its focused tests, a new additive migration under `supabase/migrations/`, and `supabase/tests/cfb_official_conferenceusa_source.sql`. Coordinate any `context.ts` instruction change with the backend owner; release that file before candidate-prompt edits.

- [x] Add failing tests for CFB Conference USA/www acceptance with real citation/source evidence, non-CFB rejection, lookalike/subdomain/credential/protocol rejection, and preservation of all prior hosts.
- [x] Run the focused test to establish the existing rejection.
- [x] Add the two exact hosts to both implementations; keep the existing record and BET timing validators unchanged.
- [x] Run focused TypeScript tests and rollback-only local SQL fixtures. Inspect migration parity and grants with independent review before production apply.
- [x] Prepare the authorized existing CFB completed-repair dry run. Verify same raw/source/check-time, intended PASS rows only, no actual-bet change, exact CAS/idempotent acknowledgment. Parent owns approval of the concrete dry-run result and operational application.

## Task 2 — Candidate parser and projector (backend worker)

Files: new `src/lib/analysis/display-candidates.ts` and test, `src/lib/analysis/actionable-bets.ts` and test, `src/lib/analysis/worker.ts` and test, `src/lib/analysis/context.ts` and test after release, shared DTO in `src/lib/latest-analysis-table.ts`.

- [x] Add failing parser tests using the exact approved CandidateBlock/ConditionalBet interfaces. Test valid explicit GO/BET, invalid fields, duplicate blocks, WAIT/PAPER/example rejection, coverage/source mismatch, wrong sport, unknown versus NB schedule values, and policy-valid units.
- [x] Implement the strict bounded parser and canonical event/source-key handling. Do not alter analysis-record storage schemas or SQL BET gates.
- [x] Add worker tests proving the block is removed before existing extractors and visible answer construction, retained in immutable raw, and malformed candidates do not discard valid canonical records.
- [x] Add projector tests for existing owner/purpose/time fences, mixed slates, known live/excluded events, null-start conditional rows, no actionable promotion, ET past-date expiry/DST, and future EARLY dates.
- [x] Add deduplication tests: exact canonical match wins, non-BET/conflicting original values are not promoted, separate distinct markets stay separate.
- [x] Update the model instructions to emit this block for explicit original recommendations excluded from storage solely by non-exact timing. Preserve strict persisted BET instructions and no Markdown fallback.
- [x] Run `npx vitest run src/lib/analysis/display-candidates.test.ts src/lib/analysis/actionable-bets.test.ts src/lib/analysis/worker.test.ts src/lib/analysis/context.test.ts src/lib/analysis/record.test.ts` and report the actual result.

## Task 3 — Private legacy overlay (backend worker; private audit by reviewer)

Files: new server-only loader `src/lib/analysis/private-display-candidates.ts` and synthetic test; latest APIs `src/app/api/analysis/latest/route.ts` and `src/app/api/sports/[sport]/latest-analysis/route.ts` plus focused tests; `.gitignore` and `.dockerignore`. Actual manifest lives outside source until copied separately to the deployed authenticated server.

- [x] Test fixed-path loading, absent file, oversized/malformed input, all identity/hash/time/evidence mismatches, cross-owner access, older-job resurrection, and safe canonical-row fallback.
- [x] Implement a strict manifest parser and one fixed cwd file read per owner request. Pass authenticated owner identity explicitly. Do not expose private file contents or permit user-controlled paths.
- [x] Ensure the manifest and private reports are excluded from Git, the normal source Docker context, static assets, and client imports. Unit tests contain synthetic financial values only. For the existing private server release only, parent may stage the exact reviewed file and exact filename Docker-ignore negation; verify artifact SHA, server permissions, and HTTP non-exposure. Never alter normal source exclusions for this exception.
- [x] Prepare the actual legacy extraction from the exact immutable response in a private directory, using UTF-8 hashes and evidence offsets; do not edit the response or its metadata. Obtain independent source/provenance review before release copy.
- [x] Test both APIs return the new conditional field without losing current valid BETs, and only the latest linked owner message can use the overlay.

## Task 4 — Compact table (UI worker)

Files: `src/lib/betting-overview.ts` and test, `src/components/sports-desk.tsx`, relevant existing styles. Use the shared type-only DTO contract; coordinate DTO ownership with backend.

- [x] Add failing tests for absent additive API field, exact original units/decimal price display, NB/estimated/date-only/unknown labels, conditional counts, date expiry, and stable distinct row identities.
- [x] Render conditional rows in the overall table with “시각·상태 확인 필요”, original schedule expression, checked time, and source conversation link. Keep display-only state visually explicit and distinct from executable BET rows.
- [x] Retain client expiry of known exact starts during failed API refreshes. Apply conditional date validity without converting NB/estimates to exact starts.
- [x] Verify a populated synthetic conditional row and normal actionable row at narrow/wide viewports; no long analysis-card regression.

## Task 5 — Independent review and release proof (parent/reviewer)

- [x] Review source classification parity, unchanged strict persistence, purpose/time/owner fences, private file handling, and original-value preservation.
- [x] Run targeted tests, then the existing full test/lint/TypeScript/build checks once after all owners freeze their files. No model calls.
- [x] Review the private overlay and CFB repair dry run before operational writes. Preserve a private before/after proof of raw/source/time and actual-bet protections.
- [x] After authorized deployment, read the current owner latest API and verify row provenance, conditional labels, untouched exact start values, original price/units, and current table behavior. Do not call analyze or retry endpoints.

All workers share a codebase: edit only assigned files, do not revert another worker, and coordinate shared files. No Git actions are part of this plan.

## Final verification and scope rulings

- 943 tests / 63 files, full lint, TypeScript and final production build passed. Independent CFB/SQL, backend/private manifest and UI reviews approved.
- Production SQL 007 applied after read-only preflight and rollback-only production validation, preserving old host rules, owner and ACL. Exact same-raw CFB CAS restored 1 event + 10 original PASS recommendations; exact replay inserted nothing and changed no audit. Original body/raw/sources/check time and 150 existing actual bets were preserved.
- Web `6bf742a2-9f3c-4a2d-8b00-4d3eb800810b` and worker `d7498402-516c-469d-8830-46914a0b6f2a` reached SUCCESS; 24 selected runtime hashes matched staging. Server private file is 0600/node-owned, returns HTTP 404 and is absent from client chunks. Anonymous overview returns 401.
- Authenticated production desktop and 390px mobile QA showed 2 existing actionable recommendations and 1 explicitly conditional Bucsa recommendation, preserving original decimal 2.04+, 0.25U and NB22:30. No exact start was invented. Browser viewport reset after QA.
- Ruling: conditional DTO/enrichment applies to the requested overall overview endpoint; the legacy single-sport full-analysis endpoint remains unchanged because its original body already shows the recommendation.
- Ruling: private runtime JSON remains Git/ordinary-Docker-context excluded; only the approved release staging copies the exact reviewed file with a one-file Dockerignore negation. Generic Docker runtime copy is optional.
- Work is in the standalone Fieldnote directory, with no GitHub remote/commits/pushes. Forbidden parent repository tracked files remain clean. No model analyses, paid fallback, new resources or hosting upgrades were used. Private audit is outside the repository under SportsDesk/verification/private-verification/cfb-conditional-display-20261027/final-verification.json.
