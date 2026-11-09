# Compact BET overview implementation plan

**Goal:** Make the existing all-sport overview a short, actionable list of explicit BET recommendations instead of eight full analysis cards.

**Design:** One combined list sorted by upcoming start time, with sport, match, market/selection, full ET date/time, original price condition, recommended risk units, assessment time and sport-conversation access. Future EARLY recommendations remain eligible, including games beyond today. Recommended units are not actual stakes. WAIT/WATCH/PASS/PAPER, result reviews, hypothetical judgments and already-started games do not become quick-action rows. Per-sport availability and incomplete fields stay in concise, optionally expanded status; an unavailable projection is not reported as a definitive absence of BETs. Full analysis and source details remain in each sport conversation.

**Architecture:** Add a read-only server projection of the latest original canonical analysis record before persistence source admission. Reuse schema, identity and policy semantics; do not parse arbitrary Markdown for BET or infer fills from price gates. Per-row original assessment, actual delivery and current time must precede a known start. Latest job request ordering prevents repaired old jobs from superseding newer decisions. No earlier BET is resurrected when the latest result has none. The client also expires rows if fetching fails. Existing owner/sport boundaries, record writes, model settings and source admission remain unchanged.

**Ownership:** Backend worker owns the projection, shared types and latest API; UI worker owns the overview renderer/styles and its focused helper; architecture reviewer independently checks eligibility. Root owns final checks, browser verification and web-only release. Preserve the ignored checkout's unrelated parent repository; no Git actions, new resources, data migrations or charged analyses.

- [x] Add canonical display projection and meaningful regressions for exact per-market BET, existing GO/EARLY aliases, incomplete fields, source-admission separation, multiple markets, assessment/delivery/start expiry, retrospective/purpose exclusions and future dates.
- [x] Extend owner-scoped latest API with projection metadata and message provenance; use consistent latest-job created_at ordering in both overview and conversation latest API. Preserve original display fields.
- [x] Replace overview cards with compact responsive rows; keep detail conversations, notifications and working scroll/layout behavior. Add client expiry/availability tests.
- [x] Independently review financial-display boundaries, then run focused/full tests, lint, TypeScript and a safe production build.
- [x] Verify desktop/mobile, no-current-BET and availability states without generating a model response or changing original records; deploy only the existing web service and verify runtime source hashes and owner reads.

## Verification evidence

- Root run: 899 tests across 61 files passed; lint, TypeScript and production build passed.
- Desktop and 390px mobile browser review with a real stored NHL recommendation row passed; no horizontal overflow and no browser errors.
- Runtime/read verification remains pending for the existing web-service deployment. No deployment is included in this implementation record.

## Release verification

Web-only Railway deployment `fc77dc3e-7f25-47d3-8fee-412ed038ed2c` reached SUCCESS. Six selected runtime source hashes match clean staging. Authenticated production read confirms all 8 sports expose the expected projection; NHL has one upcoming stored recommendation, review jobs have no actionable rows. NBA historical counts remain 41 bets, 1 adopted criterion and 5 notes. The isolated test session was revoked. No model requests, business writes, migrations or worker/gateway redeployments. Private audit: `bet-overview-20261027/final-verification.json`; populated desktop/mobile screenshots use the real saved projection through a GET-only local preview.
