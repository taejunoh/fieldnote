import { describe, expect, it } from "vitest";
import {
  conditionalSourceSnapshot,
  entryDraftIdentity,
  isManualConditionalSourceRef,
  manualConditionalEventStatus,
} from "./conditional-entry-provenance";

const sourceRef = "manual-confirmed:conditional:message-id:candidate-hash";
const source = {
  kind: "conditional_candidate" as const,
  sourceKind: "original_block" as const,
  jobId: "job-id",
  messageId: "message-id",
  itemKey: "candidate-1",
  rawSha256: "a".repeat(64),
  candidateSha256: "b".repeat(64),
};
const snapshot = {
  version: 1 as const,
  provenance: "manual_confirmed_conditional" as const,
  source,
  sourceUrl: "https://example.test/old-source",
  statusAtAssessment: "scheduled" as const,
  originalDecision: "GO" as const,
  eventKey: "match-1",
  match: "Player A vs Player B",
  market: "Moneyline",
  selection: "Player A",
  suggestedUnits: 0.25,
  priceGate: "2.04",
  schedule: { precision: "not_before" as const, dateEt: "2026-10-27", at: null, label: "NB" },
  checkedAt: "2026-10-27T20:00:00.000Z",
  deliveredAt: "2026-10-27T20:01:00.000Z",
  createdAt: "2026-10-27T20:02:00.000Z",
};

describe("conditional entry provenance and modal identity", () => {
  it("recognizes manual event markers without treating them as source URLs", () => {
    expect(isManualConditionalSourceRef(sourceRef)).toBe(true);
    expect(isManualConditionalSourceRef("https://example.test/source")).toBe(false);
    expect(manualConditionalEventStatus(sourceRef, "EVALUATION INCOMPLETE")).toEqual({
      heading: "수동 경기 등록",
      detail: "EVALUATION INCOMPLETE · 일정/원천 자료 미완료 · 원래 모델 판단 아님",
    });
  });

  it("recognizes a valid protected snapshot independently of the bet source_ref", () => {
    expect(conditionalSourceSnapshot(null, snapshot)).toMatchObject({
      originalDecision: "GO",
      priceGate: "2.04",
      suggestedUnits: 0.25,
      sourceUrl: "https://example.test/old-source",
    });
    expect(conditionalSourceSnapshot("https://example.test/existing-event-source", snapshot)).toMatchObject({
      originalDecision: "GO",
      sourceUrl: "https://example.test/old-source",
    });
    expect(conditionalSourceSnapshot(sourceRef, snapshot)).not.toBeNull();
    expect(conditionalSourceSnapshot(sourceRef, { ...snapshot, provenance: "other" })).toBeNull();
    expect(conditionalSourceSnapshot(null, { provenance: "manual_confirmed_conditional", sourceUrl: "https://example.test" })).toBeNull();
    expect(conditionalSourceSnapshot(null, { ...snapshot, source: { ...source, candidateSha256: "not-a-hash" } })).toBeNull();
  });

  it("remounts when moving between manual, recommendation and conditional drafts or changing source", () => {
    const base = { sport: "tennis", prefill: { mode: "conditional" as const, source } };
    const changed = { ...base, prefill: { mode: "conditional" as const, source: { ...source, rawSha256: "other-hash" } } };
    const recommendation = { sport: "tennis", prefill: { sourceMessageId: "message-id", sourceRecommendationId: "rec-id" } };
    expect(entryDraftIdentity(null)).not.toBe(entryDraftIdentity(recommendation));
    expect(entryDraftIdentity(recommendation)).not.toBe(entryDraftIdentity(base));
    expect(entryDraftIdentity(base)).not.toBe(entryDraftIdentity(changed));
  });
});
