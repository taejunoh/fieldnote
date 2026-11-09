import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recordRecoveryFromMetadata } from "./record-recovery";
import { APPROVED_TENNIS_SOURCE_MANIFEST_SHA256, parseApprovedIndependentSourceVerification } from "./analysis/source-verification";

describe("record recovery with the real approved-source parser", () => {
  it("does not expose schedule verification for an unapproved v2 proof envelope", () => {
    const raw = "sanitized recovery test response";
    const rawSha = createHash("sha256").update(raw).digest("hex");
    const jobId = "5c0cbeef-6c15-4a51-9418-12031a088a6b";
    const messageId = "02472f0b-af35-49e8-ad30-4bbefd6f3593";
    const fetchedAt = "2026-10-23T17:08:14.691419+00:00";
    const envelope = {
      version: 1,
      manifest_json: JSON.stringify({ version: 1, verified: true }),
      manifest_sha256: APPROVED_TENNIS_SOURCE_MANIFEST_SHA256,
    };
    expect(parseApprovedIndependentSourceVerification(envelope)).toBeNull();

    const metadata = {
      original_model_response: raw,
      checked_at: "2026-10-23T14:05:29.255Z",
      extraction_status: "complete",
      recommendations_persisted: true,
      analysis_record: { events: Array.from({ length: 8 }, () => ({})), recommendations: Array.from({ length: 20 }, () => ({})) },
      completed_analysis_repairs: [{
        version: "official-source-coverage-v2",
        repair_key: "repair-test",
        request_sha256: "a".repeat(64),
        raw_sha256: rawSha,
        repaired_at: fetchedAt,
        record_event_count: 8,
        record_recommendation_count: 20,
        job_id: jobId,
        attempt_id: "attempt-test",
        message_id: messageId,
        recommendation_key_corrections: [],
        independent_source_verifications: [envelope],
        source_verified_at: fetchedAt,
        source_verification_scope: "schedule_pair_and_date",
      }],
    };

    expect(recordRecoveryFromMetadata(metadata, { jobId, messageId, sport: "tennis" })).toMatchObject({
      status: "repaired",
      eventCount: 8,
      recommendationCount: 20,
      sourceVerifiedAt: null,
      sourceVerificationScope: null,
    });
  });
});
