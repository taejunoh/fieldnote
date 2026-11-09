import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { recordRecoveryFromMetadata } from "./record-recovery";

const { parseApprovedProof } = vi.hoisted(() => ({ parseApprovedProof: vi.fn() }));
vi.mock("./analysis/source-verification", () => ({
  APPROVED_TENNIS_SOURCE_MANIFEST_SHA256: "pinned",
  parseApprovedIndependentSourceVerification: parseApprovedProof,
}));

const raw = "original private analysis response";
const rawSha = createHash("sha256").update(raw).digest("hex");
const jobId = "job-1";
const messageId = "message-1";
const checkedAt = "2026-10-23T14:05:29.255Z";

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    original_model_response: raw,
    checked_at: checkedAt,
    extraction_status: "complete",
    recommendations_persisted: true,
    analysis_record: { events: [{ event_key: "event-1" }, { event_key: "event-2" }], recommendations: Array.from({ length: 13 }, () => ({})) },
    completed_analysis_repairs: [{
      version: "official-source-coverage-v1",
      repair_key: "repair-1",
      raw_sha256: rawSha,
      request_sha256: "a".repeat(64),
      repaired_at: "2026-10-23T18:00:00Z",
      record_event_count: 2,
      record_recommendation_count: 13,
      job_id: jobId,
      message_id: messageId,
    }],
    ...overrides,
  };
}

describe("recordRecoveryFromMetadata", () => {
  it("projects a matching completed persisted repair into the allowlisted DTO", () => {
    expect(recordRecoveryFromMetadata(metadata(), { jobId, messageId })).toEqual({
      status: "repaired",
      originalCheckedAt: checkedAt,
      repairedAt: "2026-10-23T18:00:00Z",
      sourceVerifiedAt: null,
      sourceVerificationScope: null,
      eventCount: 2,
      recommendationCount: 13,
    });
  });

  it.each([
    ["missing record", { analysis_record: undefined }],
    ["incomplete extraction", { extraction_status: "incomplete" }],
    ["recommendations not persisted", { recommendations_persisted: false }],
    ["raw digest mismatch", { completed_analysis_repairs: [{ ...metadata().completed_analysis_repairs[0], raw_sha256: "0".repeat(64) }] }],
    ["record count mismatch", { analysis_record: { events: [{}, {}, {}], recommendations: Array.from({ length: 13 }, () => ({})) } }],
    ["stale message identity", { completed_analysis_repairs: [{ ...metadata().completed_analysis_repairs[0], message_id: "other-message" }] }],
    ["invalid timestamp", { completed_analysis_repairs: [{ ...metadata().completed_analysis_repairs[0], repaired_at: "yesterday" }] }],
    ["unknown audit version", { completed_analysis_repairs: [{ ...metadata().completed_analysis_repairs[0], version: "official-source-coverage-v3" }] }],
  ])("returns null for %s", (_label, overrides) => {
    expect(recordRecoveryFromMetadata(metadata(overrides), { jobId, messageId })).toBeNull();
  });

  it("projects the actual NHL v2 correction audit shape without claiming source verification", () => {
    const correction = {
      reason: "unique_official_game_id",
      raw_sha256: rawSha,
      item_key: "recommendation-1",
      from: "nhl:2026-10-orphan",
      to: "nhl:2026-10-2026020166",
    };
    const audit = {
      ...metadata().completed_analysis_repairs[0],
      version: "official-source-coverage-v2",
      recommendation_key_corrections: [correction],
      independent_source_verifications: [],
      source_verified_at: null,
      source_verification_scope: null,
      attempt_id: "attempt-1",
    };

    expect(recordRecoveryFromMetadata(metadata({ completed_analysis_repairs: [audit] }), { jobId, messageId, sport: "nhl" })).toMatchObject({
      status: "repaired",
      sourceVerifiedAt: null,
      sourceVerificationScope: null,
      eventCount: 2,
      recommendationCount: 13,
    });
  });

  it("requires the approved full proof and derived source time before exposing tennis verification", () => {
    const sourceVerification = { version: 1, manifest_json: "approved", manifest_sha256: "pinned" };
    const manifest = {
      job_id: jobId,
      message_id: messageId,
      raw_sha256: rawSha,
      original_checked_at: checkedAt,
      scope: "schedule_pair_and_date",
      documents: [{ fetched_at: "2026-10-23T17:08:14.691419+00:00" }],
    };
    parseApprovedProof.mockImplementation((envelope: unknown) => envelope === sourceVerification ? manifest : null);
    const base = metadata({ completed_analysis_repairs: [{
      ...metadata().completed_analysis_repairs[0],
      version: "official-source-coverage-v2",
      recommendation_key_corrections: [],
      independent_source_verifications: [sourceVerification],
      source_verified_at: manifest.documents[0].fetched_at,
      source_verification_scope: "schedule_pair_and_date",
    }] });
    expect(recordRecoveryFromMetadata(base, { jobId, messageId, sport: "tennis" })).toMatchObject({
      sourceVerifiedAt: manifest.documents[0].fetched_at,
      sourceVerificationScope: "schedule_pair_and_date",
    });
    expect(recordRecoveryFromMetadata({ ...base, completed_analysis_repairs: [{ ...base.completed_analysis_repairs[0], source_verified_at: "2026-10-23T17:00:00Z" }] }, { jobId, messageId, sport: "tennis" })).toMatchObject({ sourceVerifiedAt: null });
    expect(recordRecoveryFromMetadata({ ...base, completed_analysis_repairs: [{ ...base.completed_analysis_repairs[0], source_verified_at: "2026-10-23T17:08:14.691Z" }] }, { jobId, messageId, sport: "tennis" })).toMatchObject({ sourceVerifiedAt: null });
  });
});
