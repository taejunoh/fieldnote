import { describe, expect, it } from "vitest";
import { createDeskRequestScope } from "./desk-request-scope";
import {
  conditionalEntryPayload,
  conditionalEntryPreparationRequest,
  conditionalEntrySignature,
} from "./conditional-entry-form";
import type { ConditionalEntryCandidate } from "./records/entry-types";

const candidate: ConditionalEntryCandidate = {
  source: {
    kind: "conditional_candidate",
    sourceKind: "original_block",
    jobId: "job-1",
    messageId: "message-1",
    itemKey: "match-1",
    rawSha256: "raw-hash-1",
    candidateSha256: "candidate-hash-1",
  },
  eventKey: "match-1",
  match: "Player A vs Player B",
  market: "Moneyline",
  selection: "Player A",
  originalDecision: "GO",
  suggestedUnits: 0.25,
  priceGate: "+104",
  schedule: { precision: "not_before", dateEt: "2026-10-27", at: null, label: "NB" },
  checkedAt: "2026-10-27T20:00:00.000Z",
  deliveredAt: "2026-10-27T20:01:00.000Z",
};

describe("conditional entry form requests", () => {
  it("prepares using the candidate row sport rather than the selected sport", () => {
    expect(conditionalEntryPreparationRequest("tennis", candidate.source)).toEqual({
      sportSlug: "tennis",
      source: candidate.source,
    });
  });

  it("builds only the conditional save contract and leaves suggested actuals blank", () => {
    const payload = conditionalEntryPayload("tennis", candidate, "", "", "retry-key");
    expect(payload).toEqual({
      sportSlug: "tennis",
      source: candidate.source,
      confirmed: true,
      idempotencyKey: "retry-key",
      stakeUnits: null,
      executedPrice: null,
    });
    expect(payload).not.toHaveProperty("eventId");
    expect(payload).not.toHaveProperty("market");
    expect(payload).not.toHaveProperty("selection");
    expect(payload).not.toHaveProperty("candidate");
  });

  it("changes the idempotency signature when any source reference changes", () => {
    const otherSource = { ...candidate.source, rawSha256: "raw-hash-2" };
    expect(conditionalEntrySignature("tennis", candidate.source, null, null)).not.toBe(
      conditionalEntrySignature("tennis", otherSource, null, null),
    );
  });

  it("rejects a delayed preparation after the selected sport changes", () => {
    const scope = createDeskRequestScope<string>("tennis");
    const token = scope.capture();
    scope.select("nba");
    expect(scope.isSelected(token)).toBe(false);
  });
});
