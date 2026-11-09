import type { ActionableBet, BettingOverviewProjection, ConditionalBet } from "./latest-analysis-table";

export type SportActionableBet = ActionableBet & { sport: string; sportName: string };
export type SportConditionalBet = ConditionalBet & { sport: string; sportName: string };
export type OverviewBetRow =
  | { kind: "actionable"; data: SportActionableBet; identityDate: string }
  | { kind: "conditional"; data: SportConditionalBet; identityDate: string };

const overviewReasonLabels: Record<string, string> = {
  original_record_missing: "대화 기록 확인 필요",
  original_record_missing_or_ambiguous: "원문 기록 확인 필요",
  original_event_identity_duplicate: "경기 연결 확인 필요",
  original_recommendation_invalid: "추천 내용 확인 필요",
  original_recommendation_identity_duplicate: "추천 연결 확인 필요",
  original_recommendation_unlinked: "추천 연결 확인 필요",
  original_non_entry_units_invalid: "권장 U 확인 필요",
  original_early_timing_invalid: "추천 시점 확인 필요",
  original_evaluation_timing_invalid: "평가 시점 확인 필요",
  start_time_missing_or_invalid: "경기 시작 시각 확인 필요",
  market_missing_or_invalid: "시장 정보 확인 필요",
  selection_missing_or_invalid: "선택 정보 확인 필요",
  price_gate_missing_or_invalid: "가격 조건 확인 필요",
  suggested_units_missing_or_invalid: "권장 U 확인 필요",
  assessment_or_delivery_time_unavailable: "분석 시각 확인 필요",
  assessment_not_pregame: "분석 시점 확인 필요",
  delivery_not_pregame: "전달 시점 확인 필요",
};

export function overviewReasonLabel(reason: string) {
  return overviewReasonLabels[reason] || "세부 정보 확인 필요";
}

export function uniqueOverviewReasonLabels(reasons: string[]) {
  return [...new Set(reasons.map(overviewReasonLabel))];
}

export function formatSuggestedUnits(units: number) {
  return `${units}U`;
}

export function isReviewedOriginalBodyBet(bet: Pick<ActionableBet, "provenance" | "originalDecision" | "displayOnly">): boolean {
  return bet.provenance === "reviewed_original_body" &&
    (bet.originalDecision === "BET" || bet.originalDecision === "GO" || bet.originalDecision === "EARLY GO") &&
    bet.displayOnly === true;
}

export function reviewedOriginalBodyLabel(bet: Pick<ActionableBet, "provenance" | "originalDecision" | "displayOnly">): string | null {
  return isReviewedOriginalBodyBet(bet)
    ? `원문 추천 · 검토 반영 · ${bet.originalDecision}`
    : null;
}

export function conditionalBetsOrEmpty(projection?: Partial<BettingOverviewProjection> | null) {
  return projection?.conditionalBets || [];
}

function etDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === kind)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function isValidDateEt(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/** Date identity expires at the ET date boundary; NB/estimate times are never treated as starts. */
export function currentConditionalBets(bets: SportConditionalBet[], now = new Date()) {
  const todayEt = etDate(now);
  return bets.filter((bet) => isValidDateEt(bet.schedule.dateEt) && bet.schedule.dateEt >= todayEt);
}

export function conditionalScheduleDisplay(
  schedule: SportConditionalBet["schedule"],
  statusAtAssessment: SportConditionalBet["statusAtAssessment"],
) {
  return {
    expression: schedule.label.trim() || "예정 시각 미확인",
    date: `ET 일정 날짜 ${schedule.dateEt}`,
    status: "시각·상태 확인 필요",
    assessmentStatus: statusAtAssessment === "scheduled" ? "평가 당시 일정 등록" : "평가 당시 미확인",
  };
}

export function overviewRecommendationCounts(actionable: unknown[], conditional: unknown[]) {
  return { actionable: actionable.length, conditional: conditional.length };
}

export function overviewRowIdentity(row: OverviewBetRow, index: number) {
  const bet = row.data;
  const schedule = row.kind === "conditional"
    ? `${row.data.schedule.precision}:${row.data.schedule.dateEt}:${row.data.schedule.label}:${row.data.schedule.at}`
    : row.data.startsAt;
  return [row.kind, bet.sport, bet.jobId, bet.messageId, bet.eventKey, bet.market, bet.selection, bet.priceGate, String(bet.suggestedUnits), schedule, index].join(":");
}

/** Only reviewed conditional candidates carry an entry source into the overview action. */
export function conditionalEntrySourceForOverviewRow(row: OverviewBetRow): SportConditionalBet["entrySource"] | null {
  return row.kind === "conditional" ? row.data.entrySource : null;
}

export function mergeOverviewBetRows(actionable: SportActionableBet[], conditional: SportConditionalBet[]): OverviewBetRow[] {
  const rows: OverviewBetRow[] = [
    ...actionable.map((data) => ({ kind: "actionable" as const, data, identityDate: etDate(new Date(data.startsAt)) })),
    ...conditional.map((data) => ({ kind: "conditional" as const, data, identityDate: data.schedule.dateEt })),
  ];
  return rows.sort((left, right) =>
    left.identityDate.localeCompare(right.identityDate) ||
    (left.kind === "actionable" && right.kind === "actionable"
      ? Date.parse(left.data.startsAt) - Date.parse(right.data.startsAt)
      : left.kind === "actionable" ? -1 : right.kind === "actionable" ? 1 : 0),
  );
}

/** Keep only API-projected bets whose explicit start has not passed. */
export function upcomingActionableBets(bets: SportActionableBet[], now = new Date()) {
  const nowMs = now.getTime();
  return bets
    .filter((bet) => {
      const startsAt = Date.parse(bet.startsAt);
      return Number.isFinite(startsAt) && startsAt > nowMs;
    })
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
}
