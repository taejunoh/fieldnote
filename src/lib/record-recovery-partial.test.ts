import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recordRecoveryFromMetadata } from "./record-recovery";

const checkedAt = "2026-10-27T15:48:21.000Z";
const repairedAt = "2026-10-27T17:00:00.000Z";
const context = { sport: "soccer", jobId: "job-partial", messageId: "message-partial" };
const keys = ["aaa@bbb:id-111", "ccc@ddd:id-222", "eee@fff:id-333"].map(key => `soccer:2026-10-27:${key}`);
const urls = [111, 222, 333].map(id => `https://www.fifa.com/match/${id}`);

function fixture(withRecommendations = true) {
  const events = keys.map((event_key, index) => ({ event_key, label: `Pair ${index + 1}`, starts_at: "2026-10-27T20:00:00-04:00", source_url: urls[index], analysis_status: "PASS" }));
  const recommendations = withRecommendations ? events.map((event, index) => ({ item_key: `pick_${index}`, event_key: event.event_key, market: "ML", selection: `Team ${index}`, decision: "PASS", suggested_units: 0, price_gate: "+100" })) : [];
  const original = { version: 1, sport: "soccer", events, recommendations };
  const raw = events.map((event, index) => `[Pair ${index + 1}](${event.source_url})`).join("\n") + `\n\n\`\`\`analysis-record\n${JSON.stringify(original)}\n\`\`\``;
  const admission = {
    version: 1, raw_sha256: createHash("sha256").update(raw).digest("hex"), input_event_count: 3, input_recommendation_count: recommendations.length,
    accepted_event_keys: [keys[0], keys[2]], accepted_recommendation_item_keys: withRecommendations ? ["pick_0", "pick_2"] : [],
    rejected_events: [{ index: 1, event_key: keys[1], code: "unverified_source", path: "events.1.source_url" }],
    rejected_recommendations: withRecommendations ? [{ index: 1, item_key: "pick_1", event_key: keys[1], code: "rejected_event_dependency", path: "recommendations.1.event_key" }] : [],
  };
  return {
    original_model_response: raw, checked_at: checkedAt, type: "analysis", result_type: "analysis", terminalStatus: "completed", searched: true, verified: true,
    common_policy: { id: "policy" }, input_snapshot: { attempt_id: "attempt-partial", common_policy: { id: "policy" } }, extraction_status: "partial", recommendations_persisted: withRecommendations,
    sources: [0, 2].map(index => ({ title: "FIFA", url: urls[index] })), record_admission: admission,
    coverage: { status: "incomplete", scope: { version: 1, sport: "soccer", date_et: "2026-10-27", timezone: "America/New_York", mode: "explicit", basis: "request", competitions: ["FIFA"], notes: [] } },
    analysis_record: { ...original, events: [events[0], events[2]], recommendations: recommendations.filter((_, index) => index !== 1) },
  };
}
function repaired() {
  const meta = fixture();
  return { ...meta, completed_analysis_repairs: [{ version: "source-admission-partial-v1", repair_key: "partial-repair", raw_sha256: meta.record_admission.raw_sha256, request_sha256: "a".repeat(64), original_checked_at: checkedAt, repaired_at: repairedAt, job_id: context.jobId, attempt_id: "attempt-partial", message_id: context.messageId, record_event_count: 2, record_recommendation_count: 2, record_admission: meta.record_admission }] };
}

describe("partial record status derives from the original response and sources", () => {
  it("projects normal partial persistence without claiming a historical repair", () => {
    expect(recordRecoveryFromMetadata(fixture(), context)).toMatchObject({ status: "partial", originalCheckedAt: checkedAt, repairedAt: null, eventCount: 2, recommendationCount: 2, inputEventCount: 3, inputRecommendationCount: 3, rejectedEventCount: 1, rejectedRecommendationCount: 1, rejectedReasons: ["unverified_source"], sourceVerifiedAt: null, sourceVerificationScope: null });
  });
  it("verifies and strips the saved current-analysis purpose with referenced history", () => {
    const meta = fixture();
    const purpose = { version: 1, intent: "current_analysis", basis: "fresh_web", referenced_message_ids: ["prior-message"], requires_fresh_data: true };
    meta.original_model_response += `\n\n\`\`\`response-purpose\n${JSON.stringify(purpose)}\n\`\`\``;
    meta.record_admission.raw_sha256 = createHash("sha256").update(meta.original_model_response).digest("hex");
    const saved = { ...meta, response_purpose_status: "valid", response_purpose: purpose };
    expect(recordRecoveryFromMetadata(saved, context)).toMatchObject({ status: "partial", eventCount: 2 });
    expect(recordRecoveryFromMetadata({ ...saved, response_purpose: { ...purpose, referenced_message_ids: ["other-message"] } }, context)).toBeNull();
  });
  it("keeps an events-only partial record visible when no recommendations were persisted", () => {
    expect(recordRecoveryFromMetadata(fixture(false), context)).toMatchObject({ status: "partial", eventCount: 2, recommendationCount: 0, inputRecommendationCount: 0, repairedAt: null });
  });
  it("projects a matching new repair audit with distinct original and repair times", () => {
    expect(recordRecoveryFromMetadata(repaired(), context)).toMatchObject({ status: "partial", repairedAt, originalCheckedAt: checkedAt, eventCount: 2, inputEventCount: 3 });
  });
  it.each(["digest", "accepted keys", "counts", "reason", "record", "sources", "citation", "not searched"])("rejects forged %s rather than trusting partial metadata", kind => {
    const meta = fixture();
    if (kind === "digest") meta.record_admission.raw_sha256 = "0".repeat(64);
    if (kind === "accepted keys") meta.record_admission.accepted_event_keys.reverse();
    if (kind === "counts") meta.record_admission.input_event_count = 99;
    if (kind === "reason") meta.record_admission.rejected_events[0].code = "uncited_source";
    if (kind === "record") meta.analysis_record.events[0].label = "Forged pair";
    if (kind === "sources") meta.sources.push({ title: "Promoted", url: urls[1] });
    if (kind === "citation") {
      const rawKey = keys[0].replace(":id-111", ":src");
      const canonical = rawKey.slice(0, rawKey.lastIndexOf(":")) + ":src-" + createHash("sha256").update(urls[0]).digest("hex").slice(0, 32);
      meta.original_model_response = meta.original_model_response.replaceAll(keys[0], rawKey).replace(`[Pair 1](${urls[0]})`, "Pair 1");
      meta.record_admission.raw_sha256 = createHash("sha256").update(meta.original_model_response).digest("hex");
      meta.record_admission.accepted_event_keys[0] = canonical;
      meta.analysis_record.events[0].event_key = canonical;
      meta.analysis_record.recommendations[0].event_key = canonical;
    }
    if (kind === "not searched") meta.searched = false;
    expect(recordRecoveryFromMetadata(meta, context)).toBeNull();
  });
  it.each(["raw", "count", "admission", "job", "message", "attempt", "time", "version"])("rejects a mismatched partial repair %s audit", kind => {
    const meta = repaired(); const audit = meta.completed_analysis_repairs[0];
    if (kind === "raw") audit.raw_sha256 = "0".repeat(64);
    if (kind === "count") audit.record_event_count = 3;
    if (kind === "admission") audit.record_admission = { ...audit.record_admission, input_event_count: 9 };
    if (kind === "job") audit.job_id = "other";
    if (kind === "message") audit.message_id = "other";
    if (kind === "attempt") audit.attempt_id = "other";
    if (kind === "time") audit.original_checked_at = "2026-10-27T14:00:00Z";
    if (kind === "version") audit.version = "unknown";
    expect(recordRecoveryFromMetadata(meta, context)).toBeNull();
  });
});
