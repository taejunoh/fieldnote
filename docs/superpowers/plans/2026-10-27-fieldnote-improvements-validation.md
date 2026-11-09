# Fieldnote improvement validation — 2026-10-27

Implementation and independent review are complete. Production database migrations, worker and web deployments are applied and verified below.

## Verified behavior

- The first recognized gateway terminal state is final, including framed or partial trailing data. Quota/authentication codes survive without treating every HTTP 429 as exhausted quota.
- A completed provider response is checkpointed before parsing/publication. Fenced recovery loads its original input before attempting new context and reuses original raw text, sources and check time without another model request. Publication retries are idempotent; actual delivery time remains separate from original assessment time.
- User-message retrieval is independent of assistant volume. Source-linked notes and explicit reviewed entry actions validate owner, sport and record relationships. Both note forms send stable idempotency keys. Missing actual fill price/stake remains null; a recommendation or acknowledgment alone creates no actual bet.
- Recommendation evaluation freezes the original source, keeps append-only corrections and identifies the current version. Exact reviewed full-game settlement identity is required; unsupported/ambiguous lines, missing quotes and PAPER remain unscored. Each recommendation uses its own original start/check/delivery times.
- NBA has separate registration, official-source rules and context. Its conservative import retains original raw text rather than inventing structured criteria, tickets, results or live facts. Bounded historical-source excerpts now make that actual text available to subsequent conversation.

## Verification evidence

- Final complete test run: **848 tests across 58 files passed**.
- `npm run lint`, `npx tsc --noEmit --incremental false` and `npm run build` passed.
- **22 local SQL rollback tests passed**, including migration, RLS, lease/fencing, checkpoint recovery, lineage, immutable evaluation/correction and source-policy regressions.
- Independent reviews identified and verified repairs for terminal-state override, settlement-line mismatch/split ambiguity, legacy note idempotency and bounded performance-summary/provenance labeling.
- Browser checks at **1280×720** and **390×640** kept the composer within the viewport. The source-linked note modal was inspected without writing a note or invoking a model.
- A local migration incident occurred during validation. A verified backup and data-preserving reconciliation were used before continuing; this was not a production reset. Subsequent local migration/SQL checks passed.

## Practical limits

- Conversation context is bounded to the latest **100 original user messages / 60,000 characters**, plus the existing recent-message and summary context. Truncation is explicit; this is not unlimited complete recall.
- Imported-source evidence is bounded to **three documents / 18,000 excerpt-text characters total**, with at most 6,000 characters and 80 original line fragments per document. Beginning, latest and request-relevant fragments carry document SHA and exact line/character references. Historical text remains below current corrections and adopted policy; omitted content is not claimed as read.
- Performance is a **manually reviewed, hypothetical one-risk-unit return** at an explicit observed quote, separate from actual betting profit. Late manual verification is labeled. Only supported BET evaluations enter executable ROI; current evaluation and recommendation windows are visibly bounded. This does not automatically fetch or settle outcomes.
- Recovery covers **successfully stored completed-response checkpoints**. It cannot recover an answer never durably checkpointed, and it never presents a late historical delivery as a newly issued pregame judgment.
- No production NBA source import, new historical ticket inference or charged live-model verification was performed for this release.

## Release state

- **Database applied:** `202610270003_gateway_completion_checkpoint`, `202610270004_record_lineage`, `202610270005_nba_support`, `202610270006_recommendation_evaluations`. The guarded transaction checked installed function definitions and preserved all original ten-table fingerprints exactly. No earlier migration history was replayed or repaired. The computed successor relationship returned HTTP 200 with an empty result through REST after schema reload.
- **Worker deployed:** deployment `f0fd54e8-860a-49f2-8c8e-2e4e9f787ba8` reached SUCCESS. Five runtime source hashes match the tested release; startup logs show no fatal/schema errors.
- **Web deployed:** deployment `e9c59139-b017-4b52-b044-4e21196dad52` reached SUCCESS. Five runtime source hashes match the tested release. Authenticated owner, NBA/MLB workspace, NBA records and job overview returned HTTP 200; anonymous access returned 401. The isolated smoke session was revoked without signing out other sessions. NBA workspace creation was the only expected original-table addition: sports increased from seven to eight; the other nine original table fingerprints remained unchanged, including 386 jobs, 107 actual bets and 157 notes. No model analysis was requested.

No credentials, private ledger rows or raw imported source text are included in this record. No Git commit or pull request was created in the unrelated parent repository.


## NBA source import follow-through — 2026-10-27

The user's follow-up NBA import is complete in production. Eight supplied originals were reviewed; seven were stored as separate documents and the eighth is preserved byte-for-byte inside the consolidated original (exact containment verified). One adopted NBA criterion contains the exact current source wording. Structured historical records comprise 38 events, 41 explicitly confirmed historical entries, five substantive source-linked review notes and seven summaries. Twelve missing actual stake values and their profits remain null; the one cash-out result/profit remains unknown. No recommendations or original pregame judgments were inferred from actual tickets. Imported results retain historical/unverified provenance.

Normal owner API verification returned HTTP 200 with those complete counts. The real analysis context loader includes the exact adopted criterion, current common policy, source references, historical excerpts and bounded records without a model call. It currently retrieves up to 30 events/entries and six summaries; the full stored history remains unchanged. Other seven sports and the global common policy retained their fingerprints, and no job or chat message was created. The isolated verification sessions were revoked.

The one-time verification helper initially hit a messages GET timeout (HTTP 500, PostgreSQL 57014). Stable 40-row ID pagination retrieved all 787 owner messages and matched the prior fingerprints; five local no-network helper tests passed. Previously committed documents were verified and replayed without duplicate records. No application deployment or paid model analysis was needed for this data-only follow-up. Detailed source hashes, private backups and proof are retained in the private NBA import verification directory; private ledger rows are omitted here.
