import type { StoredConditionalEntrySource } from "./records/entry-types";
import type { ConditionalEntrySource } from "./records/entry-types";

const MANUAL_CONDITIONAL_PREFIX = "manual-confirmed:conditional:";

export function isManualConditionalSourceRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(MANUAL_CONDITIONAL_PREFIX);
}

export function manualConditionalEventStatus(sourceRef: unknown, analysisStatus: unknown) {
  if (!isManualConditionalSourceRef(sourceRef)) return null;
  return {
    heading: "수동 경기 등록",
    detail: `${typeof analysisStatus === "string" && analysisStatus ? analysisStatus : "등록 상태 미확인"} · 일정/원천 자료 미완료 · 원래 모델 판단 아님`,
  };
}

export function conditionalSourceSnapshot(
  _sourceRef: unknown,
  snapshot: unknown,
): StoredConditionalEntrySource | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = snapshot as Partial<StoredConditionalEntrySource>;
  const source = value.source;
  const schedule = value.schedule;
  const isNonempty = (item: unknown): item is string => typeof item === "string" && item.trim().length > 0;
  const isTimestamp = (item: unknown) => isNonempty(item) && Number.isFinite(Date.parse(item));
  const isHttpsUrl = (item: unknown) => {
    if (!isNonempty(item)) return false;
    try { return new URL(item).protocol === "https:"; } catch { return false; }
  };
  if (
    value.version !== 1 || value.provenance !== "manual_confirmed_conditional" ||
    !source || typeof source !== "object" || source.kind !== "conditional_candidate" ||
    !["original_block", "reviewed_overlay"].includes(source.sourceKind) ||
    !isNonempty(source.jobId) || !isNonempty(source.messageId) ||
    !isNonempty(source.itemKey) || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(source.itemKey) ||
    !/^[0-9a-f]{64}$/i.test(source.rawSha256) || !/^[0-9a-f]{64}$/i.test(source.candidateSha256) ||
    !isHttpsUrl(value.sourceUrl) ||
    !isNonempty(value.originalDecision) || !["BET", "GO", "EARLY GO"].includes(value.originalDecision) ||
    !isNonempty(value.eventKey) || !isNonempty(value.match) ||
    !isNonempty(value.market) || !isNonempty(value.selection) ||
    !Number.isFinite(value.suggestedUnits) || (value.suggestedUnits ?? 0) < 0 ||
    !isNonempty(value.priceGate) ||
    !schedule || typeof schedule !== "object" ||
    !["not_before", "estimated", "date_only", "unknown"].includes(schedule.precision) ||
    typeof schedule.dateEt !== "string" || !(schedule.at === null || isTimestamp(schedule.at)) ||
    typeof schedule.label !== "string" ||
    !isTimestamp(value.checkedAt) || !isTimestamp(value.deliveredAt) || !isTimestamp(value.createdAt) ||
    !isNonempty(value.statusAtAssessment) || !["scheduled", "unknown"].includes(value.statusAtAssessment)
  ) return null;
  return value as StoredConditionalEntrySource;
}

export function entryDraftIdentity(draft: { sport: string; prefill:
  | { mode: "conditional"; source: ConditionalEntrySource }
  | { mode?: "existing"; sourceMessageId: string; sourceRecommendationId: string | null }
} | null) {
  if (!draft) return "manual-entry";
  const prefill = draft.prefill;
  return prefill.mode === "conditional"
    ? `conditional:${draft.sport}:${JSON.stringify(prefill.source)}`
    : `existing:${draft.sport}:${prefill.sourceMessageId}:${prefill.sourceRecommendationId || "message"}`;
}
