import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prepareResultsReview } from "./results-review";

const scope = { version: 1, sport: "tennis", date_et: "2026-10-28", timezone: "America/New_York", mode: "explicit", competitions: ["ATP"], basis: "request" };
const fixture = () => ({ sport: "tennis", current_job_kind: "review_results", analysis_scope: scope, scope_limitations: [],
  new_request: "Review all decisions", mistake_notes: [{ id: "mistake", content: "Retain correction" }], older_summaries: [{ id: "summary", content: "Prior caveat" }], conditional_entry_sources: [{ bet_id: "ticket", priceGate: "+100 or better", originalDecision: "WAIT" }], review_ledger_coverage: { fetched: 1, truncated: false }, common_operating_policy: { content: "complete policy" }, adopted_criteria: [{ content: "full criterion" }],
  recent_messages: [{ id: "source", role: "assistant", created_at: "2026-10-28T12:00:00Z", content: "GO Alpha. PASS Beta. WAIT Gamma. Body-only miss Delta.", metadata: { coverage: { status: "complete", scope }, historical_structured_decisions: { analysis_record: { recommendations: [{ decision: "PASS", reason: "Native-only pass" }, { decision: "WAIT", reason: "Native-only wait" }] } } } }, { id: "correction", role: "user", content: "Actual stake remains unknown." }],
  relevant_recommendations: [{ id: "rec", event_id: "event", decision: "PASS", selection: "Beta" }],
  active_events: [{ id: "event", event_key: "tennis:2026-10-28:alpha@beta:id-123", game_status: "final" }],
  confirmed_bets: [{ id: "ticket", event_id: "event", result: "won", stake_units: 2, executed_price: 150, profit_units: 900 }],
});

describe("deterministic results review preparation", () => {
  it.each(["mlb", "nfl", "cfb", "soccer", "tennis", "nba", "wnba", "nhl"])("preserves full source bodies, all decisions and corrections for %s", sport => {
    const input = { ...fixture(), sport, analysis_scope: { ...scope, sport } };
    const original = JSON.stringify(input);
    const prepared = prepareResultsReview(original);
    const result = JSON.parse(prepared.context);
    // Any lost semantic field or extra audit removal must break this provider-boundary contract.
    const { source_messages, original_context_sha256, ...modelPacket } = prepared.packet!;
    expect(result.results_review).toEqual(modelPacket);
    expect(result.results_review).not.toHaveProperty("source_messages");
    expect(result.results_review).not.toHaveProperty("original_context_sha256");
    expect(Object.keys(result.results_review)).toEqual(Object.keys(modelPacket));
    const { active_events, relevant_recommendations, confirmed_bets, conditional_entry_sources, review_ledger_coverage, ...originalFields } = input;
    const { results_review, ...retainedFields } = result;
    expect(retainedFields).toEqual(originalFields);
    expect(results_review.facts).toEqual(active_events.map(row => ({ ...row, evidence_status: "historical_recorded", independently_verified: false })));
    expect(results_review.decisions).toEqual(relevant_recommendations);
    expect(results_review.conditional_entry_sources).toEqual(conditional_entry_sources);
    expect(results_review.tickets).toEqual(confirmed_bets.map(row => ({ ...row, evidence_status: "historical_recorded", recorded_profit_units: 900, calculated_profit_units: 3, profit_discrepancy: true, resolution: "recorded_result_preview" })));
    expect(results_review.ledger_scope).toMatchObject(review_ledger_coverage);
    expect(source_messages).toHaveLength(input.recent_messages.length);
    expect(original_context_sha256).toBe(createHash("sha256").update(original).digest("hex"));
    expect(result.recent_messages).toEqual(input.recent_messages);
    expect(result.common_operating_policy).toEqual(input.common_operating_policy);
    expect(result.adopted_criteria).toEqual(input.adopted_criteria);
    expect(prepared.packet!.original_context_sha256).toBe(createHash("sha256").update(original).digest("hex"));
    expect(prepared.packet!.source_messages[0]).toMatchObject({ id: "source", content_sha256: createHash("sha256").update(input.recent_messages[0].content).digest("hex") });
    expect(prepared.packet!.review_obligation).toContain("PASS");
    expect(prepared.packet!.review_obligation).toContain("body-only");
    expect(original).toBe(JSON.stringify(input));
  });

  it("calculates preview only from actual recorded risk, price and settled result while marking historical evidence", () => {
    const prepared = prepareResultsReview(JSON.stringify(fixture()));
    expect(prepared.packet!.tickets[0]).toMatchObject({ id: "ticket", evidence_status: "historical_recorded", calculated_profit_units: 3, recorded_profit_units: 900, profit_discrepancy: true });
    expect(prepared.packet!.facts[0]).toMatchObject({ id: "event", evidence_status: "historical_recorded", independently_verified: false });
    expect(prepared.packet!.ledger_scope).toMatchObject({ complete_ledger: false });
    expect(prepared.packet!.settlement_authority).toContain("preview");
  });

  it("leaves unknown and ambiguous tickets unresolved without inferring actuals from recommendations", () => {
    const input = fixture();
    input.confirmed_bets = [
      { id: "unknown", event_id: "event", result: "won", stake_units: null as unknown as number, executed_price: 100, profit_units: 0 },
      { id: "retirement", event_id: "event", result: "retired", stake_units: 1, executed_price: 100, profit_units: 0 },
    ];
    input.scope_limitations = ["review_scope_unresolved"] as never[];
    const prepared = prepareResultsReview(JSON.stringify(input));
    expect(prepared.packet!.tickets.map(row => row.calculated_profit_units)).toEqual([null, null]);
    expect(prepared.packet!.scope_status).toBe("unresolved");
    expect(prepared.packet!.required_verification).toContain("live_search_required");
    expect(prepared.packet!.ledger_scope).toMatchObject({ complete_ledger: false });
  });

  it("is deterministic and gracefully preserves legacy non-JSON context", () => {
    expect(prepareResultsReview(JSON.stringify(fixture()))).toEqual(prepareResultsReview(JSON.stringify(fixture())));
    expect(prepareResultsReview("legacy context")).toEqual({ context: "legacy context", packet: null });
  });
});

it.each(["mlb", "nfl", "cfb", "soccer", "tennis", "nba", "wnba", "nhl"])("reduces complete UTF8 input bytes for %s while retaining identical source evidence", async sport => {
  const { instructionsForContext, resultsReviewInstructions } = await import("./context");
  const original = JSON.stringify({ ...fixture(), sport, analysis_scope: { ...scope, sport } });
  const prepared = prepareResultsReview(original);
  const beforeBytes = Buffer.byteLength(original + instructionsForContext(true, false), "utf8");
  const afterBytes = Buffer.byteLength(prepared.context + resultsReviewInstructions(true), "utf8");
  expect(afterBytes).toBeLessThan(beforeBytes);
  const packetContext = JSON.parse(prepared.context);
  expect(packetContext).not.toHaveProperty("confirmed_bets");
  expect(packetContext.results_review.tickets).toHaveLength(1);
  expect(packetContext.recent_messages).toEqual(JSON.parse(original).recent_messages);
});

it.each([
  { source_ref: "cashout:legacy-SAS" },
  { source_ref: "캐시아웃 확인" },
  { source_candidate: { settlementType: "partial" } },
  { source_candidate: { promotion: "bonus_bet" } },
  { source_candidate: { cashout: true } },
])("keeps explicitly nonstandard ticket settlement unresolved despite a stored lost result (%j)", evidence => {
  const input = { ...fixture(), confirmed_bets: [{ id: "special", result: "lost", stake_units: 1, executed_price: -110, profit_units: -0.25, ...evidence }] };
  const ticket = prepareResultsReview(JSON.stringify(input)).packet!.tickets[0];
  expect(ticket).toMatchObject({ calculated_profit_units: null, recorded_profit_units: -0.25, resolution: "unresolved", unresolved_reason: "nonstandard_ticket_settlement" });
});

it("normalizes only stored actual numeric strings and preserves null actuals as unknown", () => {
  const input = { ...fixture(), confirmed_bets: [{ id: "actual", result: "won", stake_units: "2", executed_price: "150", suggested_units: 99 }, { id: "missing", result: "won", stake_units: null, executed_price: "150", suggested_units: 99 }] };
  expect(prepareResultsReview(JSON.stringify(input)).packet!.tickets.map(ticket => ticket.calculated_profit_units)).toEqual([3, null]);
});

it.each([
  ["900", true], ["3", false], [3, false], [null, null], [undefined, null], ["invalid", null], ["", null],
])("compares normalized recorded actual profit without treating unknown as a clean match (%j)", (recorded, expected) => {
  const input = { ...fixture(), confirmed_bets: [{ id: "actual", result: "won", stake_units: "2", executed_price: "150", profit_units: recorded }] };
  const ticket = prepareResultsReview(JSON.stringify(input)).packet!.tickets[0];
  expect(ticket).toMatchObject({ calculated_profit_units: 3, recorded_profit_units: recorded ?? null, profit_discrepancy: expected });
});

it("leaves recorded profit comparison unknown for unsupported cashout arithmetic", () => {
  const input = { ...fixture(), confirmed_bets: [{ id: "special", result: "lost", stake_units: "2", executed_price: "150", profit_units: "-0.5", source_ref: "cashout:legacy-SAS" }] };
  expect(prepareResultsReview(JSON.stringify(input)).packet!.tickets[0]).toMatchObject({ recorded_profit_units: "-0.5", calculated_profit_units: null, profit_discrepancy: null, resolution: "unresolved" });
});
