# Reviewed exact-time original-body projection

Status: approved bounded repair. This document contains synthetic examples only; owner identifiers, real picks, prices, source hashes and reviewed source evidence belong in the private verification directory. The fix request authorizes implementation; no additional design approval is needed.

## Problem and selected design

A current body recommendation can be absent from both native `analysis-record` and nonexact `analysis-candidates`. Existing canonical projection correctly cannot invent an absent native row. Existing nonexact candidates correctly reject an exact schedule. Reclassifying an exact start as estimated or inserting derived database records would misrepresent the original source and does not repair canonical projection.

Add a separate, reviewed exact-time display projection, pinned to the original immutable completed attempt and private evidence. Preserve original raw, native records and prior decisions. Future eligible exact recommendations should use the existing native contract. This is a display repair, not a new actual-entry contract.

## Wire and loader contracts

```ts
// Existing ActionableBet fields are retained. These optional fields occur together
// on reviewed exact rows; native rows omit them.
type ReviewedFields = {
  provenance: "reviewed_original_body";
  originalDecision: "BET" | "GO" | "EARLY GO";
  displayOnly: true;
};
// ActionableBet adds Partial<ReviewedFields>; the producer enforces all-or-none.
// No entrySource field is added. ConditionalBet and entry schemas stay unchanged.

type ExactSchedule = {
  precision: "exact";
  date_et: string;
  at: string; // non-null ISO instant with explicit offset
  label: string;
};
type ReviewedExactCandidate = {
  item_key: string; event_key: string; market: string; selection: string;
  decision: "BET" | "GO" | "EARLY GO"; suggested_units: number;
  price_gate: string; source_url: string; schedule: ExactSchedule;
  status_at_assessment: "scheduled";
};
type ReviewedExactOverlay = {
  owner_id: string; sport: string; job_id: string; message_id: string;
  raw_sha256: string; checked_at: string; created_at: string; delivered_at: string;
  envelope: {version: 1; sport: string; candidates: [ReviewedExactCandidate]};
  coverage: [{event_key: string; label: string; source_url: string; date_et: string}];
  evidence: Array<{role: "recommendation" | "price" | "units" | "schedule" | "status";
    start: number; end: number; text: string; sha256: string}>;
};
type ManifestV2 = {version: 2; entries: CandidateOverlay[];
  exact_entries: ReviewedExactOverlay[]};
// Existing {version:1,entries:CandidateOverlay[]} remains accepted unchanged.
loadPrivateDisplayCandidates(): Promise<CandidateOverlay[]>;
loadPrivateOverviewCandidates(): Promise<{
  conditional: CandidateOverlay[]; exact: ReviewedExactOverlay[];
}>;
```

The exact schema is strict and separate. Reuse existing string, UUID/hash, URL, byte and entry-count limits where applicable. Exact envelope contains exactly one candidate; evidence includes all five roles and matching UTF-8 byte slices/hashes. Preserve the existing bounded 64KiB private file reader. A version2 manifest retains the v1 entries without rewriting their contents. The legacy loader returns only nonexact entries, including when reading version2. Invalid or oversized input fails closed; no client-controlled path, remote manifest or service secret in client code.

## Source and projection admission

Factor the existing `entryCandidatesForMessage` source predicates into an analysis-level helper without removing predicates. Existing conditional resolution continues through that helper. Validate owner/sport/assistant message/job/result linkage; completed current attempt identity; original raw, checked time, sources, policy, purpose/hypothetical/delivery and verification flags; input attempt/context/instruction hashes, policy, sport and requested job kind. Matching mutable job and message copies alone are insufficient. Retain canonical purpose exclusions.

The latest route loads a matching immutable attempt before returning any reviewed exact row. The exact projector then requires:

1. Exact owner, sport, job, message, raw hash, checked/created/delivered pins and evidence slices.
2. One original coverage inventory identity with matching label, URL, ET date and the same exact instant. Reject excluded coverage, known live/final/cancelled state, ambiguous identities and incompatible canonical event state/start.
3. An official admitted URL that appears in original searched sources and original citation evidence. Preserve exact URL matching. Normalize supported `:src` keys using the existing URL hash; never require or invent an official fixture ID.
4. Original assessment, message creation and delivery strictly before the exact start, all no later than the real current clock. Display only while the exact start is strictly future. No historical clock substitution.
5. Unique event/market/selection. Equivalent native recommendation wins without duplicate display. Conflicting canonical decision, price, units, schedule or ambiguous evidence fails closed and yields a review reason.
6. Original decision, suggested units and price condition are copied unchanged. The current clock or a later status check does not refresh the original quote timestamp.

A failed matching overlay/source produces an explicit unavailable/review-needed indication rather than a claim that the body contains no recommendations. Do not report financial recommendation counts by scanning arbitrary prose.

## UI behavior

Show exact reviewed rows with the original decision and `원문 추천 · 검토 반영`. Show original checked/as-of time beside the original price condition. The normal start expiry filter still applies. The action opens the source sport/chat. No conditional entrySource, entry preparation or save button is introduced for these rows. Native rows and existing nonexact actual-entry controls remain unchanged. A later exact-row actual-entry feature would need its own reviewed source/snapshot/API/SQL contract.

## Future native admission and omissions

Add only the verified official soccer club host `nashvillesc.com` and its explicit `www` form to native official admission. Preserve sport scoping, HTTPS, no credentials/port, exact searched/cited URL and lookalike rejection. Do not allow arbitrary club domains or subdomains.

Clarify the source prompt: an official fixture ID is not mandatory; existing valid participant/date identity plus verified official URL supports `:src`. Eligible future exact prose GO maps to native BET, and EARLY GO maps to BET with timing early. Preserve recommendation/actual-entry distinction, original units and price, and schedule uncertainty. Ineligible storage does not force a different prose judgment; explain the actual restriction.

Reuse existing admission/recovery warnings. Do not create a generic GO regex financial parser or assume coverage disposition evaluated proves a current bet. If an explicit future projection-incomplete declaration is used, it is only a boolean warning with open-chat action, never an authorization or financial row. Such a marker is optional and cannot prove completeness when absent. Prompt and regression changes prevent the identified path; they cannot guarantee arbitrary future prose/structured consistency.

## Non-goals and invariants

No SQL or schema migration; no changes to SQL008, source_candidate, conditional entry DTOs or bet saves. No original-message rewriting, ledger writes, recommendation inserts, automatic model retry, price refresh, universal new betting rule or source-policy weakening. Preserve v1 reviewed conditional candidates and historical entry behavior.

## Acceptance matrix

| Case | Required result |
|---|---|
| Synthetic valid exact source before start | One labelled reviewed row with original as-of |
| At/after start | No current row |
| Wrong owner/sport/job/message/current attempt/hash/input/policy/purpose | No row; matching gap indicated |
| Job+message jointly rewritten, trusted attempt unchanged | Rejected |
| Bad UTF-8 range, hash, role or differing coverage timestamp | Rejected |
| URL unsearched/uncited/unofficial/lookalike | Rejected |
| Native equivalent/conflict/ambiguous duplicates | Dedupe / fail closed / fail closed |
| v1 manifest and nonexact entry prep | Existing behavior unchanged |
| v2 exact-only through legacy loader/entry API | No conditional sources; exact reference rejected |
| Current time or fresh status fetch | Never replaces original checkedAt/price |
| Review/hypothetical or historical GO prose | No newly fabricated row |

Release verification uses current protected-state baselines and a fresh read-only source attestation. Production QA opens the overview/source only. No actual bet saves, model jobs or production business writes are needed.
