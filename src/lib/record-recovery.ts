import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { extractAnalysisRecord, type RecordAdmission } from "./analysis/record";
import { extractCoverageReport, parseStoredCoverageScope } from "./analysis/coverage";
import { extractResponsePurpose } from "./analysis/response-purpose";
import type { GatewaySource } from "./analysis/gateway";
import {
  parseApprovedIndependentSourceVerification,
  type ApprovedSourceManifest,
} from "./analysis/source-verification";

type CompleteRecordRecoveryDTO = {
  status: "repaired";
  originalCheckedAt: string | null;
  repairedAt: string;
  sourceVerifiedAt: string | null;
  sourceVerificationScope: "schedule_pair_and_date" | null;
  eventCount: number;
  recommendationCount: number;
};

export type PartialRecordRecoveryDTO = {
  status: "partial";
  originalCheckedAt: string;
  repairedAt: string | null;
  sourceVerifiedAt: null;
  sourceVerificationScope: null;
  eventCount: number;
  recommendationCount: number;
  inputEventCount: number;
  inputRecommendationCount: number;
  rejectedEventCount: number;
  rejectedRecommendationCount: number;
  rejectedReasons: RecordAdmission["rejected_events"][number]["code"][];
};

export type RecordRecoveryDTO = CompleteRecordRecoveryDTO | PartialRecordRecoveryDTO;

type RecoveryContext = { jobId?: string | null; messageId?: string | null; sport?: string };
type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
}

function validInstant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function validSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function verifiedAtFromManifest(manifest: ApprovedSourceManifest): string | null {
  if (manifest.scope !== "schedule_pair_and_date" || !manifest.documents.length) return null;
  const timestamps = manifest.documents.map((document) => Date.parse(document.fetched_at));
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) return null;
  const latest = Math.max(...timestamps);
  return manifest.documents.find((document) => Date.parse(document.fetched_at) === latest)?.fetched_at ?? null;
}

function sourceVerificationFromAudit(
  audit: ObjectValue,
  rawSha: string,
  checkedAt: string | null,
  context: RecoveryContext,
): Pick<RecordRecoveryDTO, "sourceVerifiedAt" | "sourceVerificationScope"> {
  const absent = { sourceVerifiedAt: null, sourceVerificationScope: null } as const;
  if (audit.version !== "official-source-coverage-v2" || context.sport !== "tennis" || !Array.isArray(audit.independent_source_verifications)) return absent;
  const envelopes = audit.independent_source_verifications;
  if (envelopes.length !== 1 || !context.jobId || !context.messageId) return absent;

  const manifest = parseApprovedIndependentSourceVerification(envelopes[0]);
  if (!manifest || manifest.job_id !== context.jobId || manifest.message_id !== context.messageId || manifest.raw_sha256 !== rawSha ||
      (checkedAt !== null && manifest.original_checked_at !== checkedAt)) return absent;
  const sourceVerifiedAt = verifiedAtFromManifest(manifest);
  if (!sourceVerifiedAt || !validInstant(audit.source_verified_at) || audit.source_verified_at !== sourceVerifiedAt ||
      audit.source_verification_scope !== "schedule_pair_and_date") return absent;

  return { sourceVerifiedAt, sourceVerificationScope: "schedule_pair_and_date" };
}

/** Re-derive source admission; metadata counts alone cannot authorize a partial badge. */
function partialRecoveryFromMetadata(metadata: ObjectValue, context: RecoveryContext): PartialRecordRecoveryDTO | null {
  if (!context.sport || metadata.type !== "analysis" || metadata.result_type !== "analysis" || metadata.terminalStatus !== "completed" ||
      metadata.searched !== true || metadata.verified !== true || typeof metadata.original_model_response !== "string" ||
      !metadata.original_model_response.trim() || !validInstant(metadata.checked_at) || !Array.isArray(metadata.sources) ||
      !metadata.sources.every(source => { const row = object(source); return row && typeof row.url === "string" && typeof row.title === "string"; })) return null;
  const input = object(metadata.input_snapshot);
  if (!input || !isDeepStrictEqual(metadata.common_policy ?? null, input.common_policy ?? null)) return null;
  const scope = parseStoredCoverageScope(metadata, context.sport);
  if (!scope) return null;
  const raw = metadata.original_model_response;
  const rawSha = createHash("sha256").update(raw, "utf8").digest("hex");
  const savedPurpose = object(metadata.response_purpose);
  const references = metadata.response_purpose_status === "valid" && Array.isArray(savedPurpose?.referenced_message_ids) &&
    savedPurpose.referenced_message_ids.every(id => typeof id === "string") ? savedPurpose.referenced_message_ids as string[] : [];
  const purpose = extractResponsePurpose(raw, new Set(references));
  if (metadata.response_purpose_status === "valid" && !isDeepStrictEqual(purpose.purpose, savedPurpose)) return null;
  const sources = metadata.sources as GatewaySource[];
  const coverage = extractCoverageReport(purpose.purpose ? purpose.answer : raw, scope, sources);
  const derived = extractAnalysisRecord(coverage.answer, context.sport, sources, new Date(metadata.checked_at), {
    commonPolicyAdopted: Boolean(metadata.common_policy), scopeDate: scope.date_et, originalRawSha256: rawSha,
  });
  if (derived.status !== "partial" || !isDeepStrictEqual(derived.record, metadata.analysis_record) ||
      !isDeepStrictEqual(derived.record_admission, metadata.record_admission) ||
      metadata.recommendations_persisted !== (derived.record.recommendations.length > 0)) return null;

  let repairedAt: string | null = null;
  const repairs = metadata.completed_analysis_repairs;
  if (repairs !== undefined && !Array.isArray(repairs)) return null;
  if (Array.isArray(repairs) && repairs.length) {
    const audit = object(repairs[repairs.length - 1]);
    if (!audit || audit.version !== "source-admission-partial-v1" || typeof audit.repair_key !== "string" || !audit.repair_key.trim() ||
        audit.raw_sha256 !== rawSha || !validSha(audit.request_sha256) || !validInstant(audit.repaired_at) ||
        audit.original_checked_at !== metadata.checked_at || Date.parse(audit.repaired_at) < Date.parse(metadata.checked_at) ||
        !context.jobId || !context.messageId || audit.job_id !== context.jobId || audit.message_id !== context.messageId ||
        typeof input.attempt_id !== "string" || audit.attempt_id !== input.attempt_id ||
        audit.record_event_count !== derived.record.events.length || audit.record_recommendation_count !== derived.record.recommendations.length ||
        !isDeepStrictEqual(audit.record_admission, derived.record_admission)) return null;
    repairedAt = audit.repaired_at;
  } else if (object(metadata.analysis_record_provenance)?.kind === "saved_response_partial_repair") return null;

  const admission = derived.record_admission;
  return {
    status: "partial", originalCheckedAt: metadata.checked_at, repairedAt,
    sourceVerifiedAt: null, sourceVerificationScope: null,
    eventCount: derived.record.events.length, recommendationCount: derived.record.recommendations.length,
    inputEventCount: admission.input_event_count, inputRecommendationCount: admission.input_recommendation_count,
    rejectedEventCount: admission.rejected_events.length, rejectedRecommendationCount: admission.rejected_recommendations.length,
    rejectedReasons: [...new Set(admission.rejected_events.map(row => row.code))],
  };
}

/** Projects a recovery DTO only when the saved record and latest repair audit agree. */
export function recordRecoveryFromMetadata(metadataValue: unknown, context: RecoveryContext = {}): RecordRecoveryDTO | null {
  const metadata = object(metadataValue);
  if (metadata?.extraction_status === "partial") return partialRecoveryFromMetadata(metadata, context);
  if (!metadata || metadata.extraction_status !== "complete" || metadata.recommendations_persisted !== true ||
      typeof metadata.original_model_response !== "string" || !metadata.original_model_response.trim()) return null;

  const record = object(metadata.analysis_record);
  if (!record || !Array.isArray(record.events) || !Array.isArray(record.recommendations)) return null;
  const rawSha = createHash("sha256").update(metadata.original_model_response, "utf8").digest("hex");
  const audits = metadata.completed_analysis_repairs;
  if (!Array.isArray(audits) || !audits.length) return null;
  const audit = object(audits[audits.length - 1]);
  if (!audit || !["official-source-coverage-v1", "official-source-coverage-v2"].includes(String(audit.version)) || typeof audit.repair_key !== "string" || !audit.repair_key.trim() ||
      !validSha(audit.raw_sha256) || audit.raw_sha256 !== rawSha || !validSha(audit.request_sha256) ||
      !validInstant(audit.repaired_at) || !Number.isSafeInteger(audit.record_event_count) || !Number.isSafeInteger(audit.record_recommendation_count) ||
      audit.record_event_count !== record.events.length || audit.record_recommendation_count !== record.recommendations.length) return null;

  if (audit.version === "official-source-coverage-v2") {
    if (typeof audit.job_id !== "string" || !audit.job_id || typeof audit.message_id !== "string" || !audit.message_id ||
        !Array.isArray(audit.recommendation_key_corrections) || !Array.isArray(audit.independent_source_verifications) || audit.independent_source_verifications.length > 1 ||
        !((audit.source_verified_at === null && audit.source_verification_scope === null && audit.independent_source_verifications.length === 0) ||
          (validInstant(audit.source_verified_at) && audit.source_verification_scope === "schedule_pair_and_date" && audit.independent_source_verifications.length === 1))) return null;
  }

  if (audit.job_id !== undefined && context.jobId !== undefined && context.jobId !== null && audit.job_id !== context.jobId) return null;
  if (audit.message_id !== undefined && context.messageId !== undefined && context.messageId !== null && audit.message_id !== context.messageId) return null;

  const originalCheckedAt = validInstant(metadata.checked_at) ? metadata.checked_at : null;
  const verification = sourceVerificationFromAudit(audit, rawSha, originalCheckedAt, context);
  return {
    status: "repaired",
    originalCheckedAt,
    repairedAt: audit.repaired_at,
    ...verification,
    eventCount: record.events.length,
    recommendationCount: record.recommendations.length,
  };
}
