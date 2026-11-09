# CFB official sources and conditional recommendation display

Approved scope: recognize Conference USA as an official CFB source and show explicitly recommended selections whose precise start is unavailable. Work only in `<Fieldnote workspace>`. No commits, pushes, remote creation, paid model calls, or unrelated changes.

## Boundaries

Analysis, recommendation display, persisted recommendations, and actual bets remain separate. Keep the existing `analysis-record` and SQL rules: a stored BET requires a verified future exact start. No candidate creates an event, recommendation, actual bet, settlement, or revised historical judgment.

An explicit original GO/BET with completed price reasoning may appear as a **display-only conditional recommendation**. WAIT, WATCH, PAPER, a quoted example, a hypothetical, and “BET candidate” language do not become recommendations. Preserve the original price condition and positive policy-valid suggested units; never convert decimal prices into fabricated American fills.

## Structured future responses

Add one optional fenced `analysis-candidates` JSON block between coverage and the final analysis-record. General conversation still follows response-purpose rules. The new block is independent of storage admission and is bounded to 20 rows and 64 KiB.

```ts
type CandidateSchedule = {
  precision: "not_before" | "estimated" | "date_only" | "unknown";
  date_et: string; // validated YYYY-MM-DD, linked to the event identity
  at: string | null; // offset ISO bound/estimate, NEVER an exact start
  label: string; // original scheduled/NB/unknown expression
};
type DisplayCandidate = {
  item_key: string;
  event_key: string;
  market: string;
  selection: string;
  decision: "BET" | "GO" | "EARLY GO";
  suggested_units: number;
  price_gate: string;
  source_url: string;
  schedule: CandidateSchedule;
  status_at_assessment: "scheduled" | "unknown" | "live" | "final" | "cancelled";
};
type CandidateBlock = { version: 1; sport: string; candidates: DisplayCandidate[] };
```

Use the existing sport registry, event-key grammar, source-hash canonicalization, item identity, policy decision aliases, and unit rules. GO aliases require the adopted policy, as for existing records. Do not make arbitrary Markdown extraction a fallback.

Each candidate must link to the original coverage inventory's event key, source URL, and ET identity date. Obtain the match label there. Reject duplicated item keys, identity conflicts, malformed dates, and missing market/selection/price/unit fields. Preserve exact quote text. Source provenance must be present in the original response/source evidence; passing storage's official-host allowlist is not a prerequisite for display.

`not_before` and `estimated` require an offset ISO `at` and an original label; `date_only` and `unknown` require `at:null`. Compare the bound/estimate's ET date to the schedule identity, accounting for explicit date-boundary limitations. Do not turn NB or public estimates into `starts_at`.

Strip the recognized block before passing the answer into existing coverage/record extraction and rendering. The immutable `original_model_response` retains it. An invalid or duplicate candidate block fails candidate display closed and supplies a review reason; it must not invalidate an otherwise valid existing canonical BET or bypass response-purpose validation.

## Shared display contract

Keep `actionableBets` unchanged. Add:

```ts
type ConditionalBet = Omit<ActionableBet, "startsAt"> & {
  startsAt: null;
  displayOnly: true;
  schedule: {
    precision: "not_before" | "estimated" | "date_only" | "unknown";
    dateEt: string;
    at: string | null;
    label: string;
  };
  statusAtAssessment: "scheduled" | "unknown";
};
// BettingOverviewProjection adds conditionalBets: ConditionalBet[].
```

The overall table may contain both types. Conditional rows show their original NB/scheduled label or “예정 시각 미확인”, plus “시각·상태 확인 필요”. They never look like confirmed current executable bets. Preserve the original assessment time and link to the source sport conversation. Counts must distinguish actionable and conditional rows; an existing response without this additive field behaves as an empty conditional array.

## Purpose, timing, and deduplication

- Apply authenticated owner, sport, latest completed job, linked assistant message, raw-purpose, checked-time, and delivery fences before either display path. Do not retrieve an older recommendation when the latest result has none.
- Exclude retrospective/hypothetical/general-conversation purposes and known live/final/cancelled events. Preserve per-row handling for mixed slates.
- Exclude coverage events classified `excluded`. A future candidate cannot override a known exact start that has already passed or contradictory current-record status.
- A non-exact candidate remains conditional even if its NB is still in the future. Once NB passes, do not assert the event started; retain the uncertainty label while its ET date remains valid.
- Expire a past ET identity date. Allow future ET dates, including EARLY recommendations. Do not invent a TTL or an exact midnight start. Cross-midnight uncertainty is disclosed, not converted into a new date.
- `checked_at <= actual delivery <= now` must remain valid. Use original timestamps; loading a manifest is not a new data verification.
- Never duplicate an existing canonical recommendation in the candidate list. An exact matching canonical entry takes precedence. Conflicting same-event/market/selection price or units yields a review reason rather than selecting one silently. A canonical non-BET cannot be promoted by an inconsistent candidate.

## Existing-response repair without model or DB mutation

Use an optional private server file named `private-display-candidates.json`, resolved only from the fixed runtime working directory (`/app` in the deployed service). No caller-supplied path, glob search, URL download, or public endpoint serves the file. Exclude it from Git, the normal source Docker build context, public assets, and client bundles.

Approved deployment exception: the parent may copy the exact privately reviewed artifact into a whitelisted staging directory for the existing authenticated server release, and add an exact filename Docker-ignore negation **in staging only**. The resulting private server image intentionally contains that owner's display data. Do not change the normal source exclusions or publish the file through static assets/client output. Verify the staged and deployed SHA, restrictive readable permissions for the server runtime identity, and that unauthenticated HTTP cannot fetch the file. This is release packaging, not a DB metadata write or a newly verified analysis.

The generic loader accepts a strict versioned bounded manifest. Each entry pins authenticated owner ID, sport, job ID, message ID, raw UTF-8 SHA-256, original checked/delivery timestamps, candidate payload, exact raw-coverage identity, and exact UTF-8 evidence spans/quotes for recommendation, price, units, schedule, and status. Treat it as a separately reviewed extraction of an existing answer, never as independent source verification.

```ts
type PrivateDisplayManifest = {
  version: 1;
  entries: Array<{
    owner_id: string; sport: string; job_id: string; message_id: string;
    raw_sha256: string;
    checked_at: string; created_at: string; delivered_at: string;
    envelope: { version: 1; sport: string; candidates: [DisplayCandidate] };
    coverage: [{ event_key: string; label: string; source_url: string; date_et: string }];
    evidence: Array<{
      role: "recommendation" | "price" | "units" | "schedule" | "status";
      start: number; end: number; text: string; sha256: string;
    }>;
  }>;
};
```

Bound the file to 64 KiB and 20 entries. Require exactly one candidate and one matching coverage row per entry, and every evidence role; one original span may support multiple roles. `start` and `end` are UTF-8 byte offsets, not JavaScript UTF-16 string indices; each evidence SHA-256 hashes the exact UTF-8 text. The reviewed private file is the authority for the mapping; quotes alone are not a generic natural-language parser. Check the raw original coverage block, not only mutable extracted metadata.

Load once per owner GET and pass the relevant entries to the pure projector. Revalidate the selected message and all pins at read time. Missing, malformed, oversized, mismatched, or stale manifests add no candidate and leave existing valid canonical rows available. The latest-job check prevents resurrection after a subsequent analysis. Never accept arbitrary message metadata as equivalent authority.

The actual Bucsa financial details and owner identifiers belong only in that private artifact and private audit evidence, not in committed application code, public fixtures, or this document. Synthetic fixtures test the generic mechanism. No original response, message metadata, source list, checked time, or recommendation row is edited.

## CFB official-source repair

Add exact HTTPS hosts `conferenceusa.com` and `www.conferenceusa.com` to the CFB TypeScript allowlist and `official_event_source_allowed` SQL implementation. Preserve existing hosts and other sports. Reject lookalike suffixes, arbitrary subdomains, credentials, and invalid protocols; retain existing permitted-port semantics. Do not edit unrelated pinned tennis verification logic.

Use an additive, reviewable migration and rollback-only local SQL tests. Application and SQL acceptance must agree before deployment. No broad conference/school wildcard.

The explicitly authorized existing CFB PASS repair uses the existing completed-analysis repair machinery: read-only dry run first, original raw/source/check-time verification, owner/job/message CAS fences, unchanged body/history and actual bets, then the existing idempotent service-only repair path. Do not regenerate analysis or reclassify PASS as BET. Inspect the exact prepared diff and acknowledgment before reporting success.

## Acceptance evidence

Validate the new parser/projection/worker and UI against synthetic explicit recommendations, malformed blocks, owner/raw/purpose mismatches, same-day NB before and after its bound, date rollover/DST, future EARLY dates, known started events, duplicate/conflicting rows, and unchanged decimal prices/units. Existing strict BET-null-start persistence tests must still reject. Test CFB source parity with rollback-only SQL. Independently review the private overlay and CFB dry run before production application. Verify the actual latest owner API and table after release without model calls.
