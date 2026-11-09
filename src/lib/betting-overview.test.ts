import { describe, expect, it } from "vitest";

import {
  conditionalBetsOrEmpty,
  conditionalEntrySourceForOverviewRow,
  conditionalScheduleDisplay,
  currentConditionalBets,
  formatSuggestedUnits,
  isReviewedOriginalBodyBet,
  reviewedOriginalBodyLabel,
  mergeOverviewBetRows,
  overviewReasonLabel,
  overviewRecommendationCounts,
  overviewRowIdentity,
  upcomingActionableBets,
  uniqueOverviewReasonLabels,
  type SportActionableBet,
  type SportConditionalBet,
} from "./betting-overview";

const bet = (eventKey: string, startsAt: string): SportActionableBet => ({
  eventKey,
  match: eventKey,
  startsAt,
  market: "full-game spread",
  selection: "Home -3.5",
  suggestedUnits: 0.5,
  priceGate: "-110 or better",
  checkedAt: "2026-10-27T12:00:00Z",
  messageId: `message-${eventKey}`,
  jobId: `job-${eventKey}`,
  sport: "nfl",
  sportName: "NFL",
});

const conditional = (
  precision: SportConditionalBet["schedule"]["precision"],
  dateEt = "2026-10-27",
  label = "Not before 8:00 PM ET",
): SportConditionalBet => ({
  eventKey: `cfb:${dateEt}:away@home`,
  match: "Away at Home",
  startsAt: null,
  market: "full-game moneyline",
  selection: "Away",
  suggestedUnits: 0.125,
  priceGate: "-110 or better",
  checkedAt: "2026-10-27T12:00:00Z",
  messageId: "message-cfb",
  jobId: "job-cfb",
  displayOnly: true,
  entrySource:{kind:"conditional_candidate",sourceKind:"original_block",jobId:"job-cfb",messageId:"message-cfb",itemKey:"pick",rawSha256:"a".repeat(64),candidateSha256:"b".repeat(64)},
  schedule: { precision, dateEt, at: precision === "date_only" || precision === "unknown" ? null : "2026-10-27T19:00:00-04:00", label },
  statusAtAssessment: "scheduled",
  sport: "cfb",
  sportName: "CFB",
});

describe("upcoming actionable overview bets", () => {
  it("keeps reviewed exact recommendations distinct from native and conditional rows", () => {
    const reviewed = {
      ...bet("reviewed-exact", "2026-10-28T20:00:00Z"),
      provenance: "reviewed_original_body" as const,
      originalDecision: "EARLY GO" as const,
      displayOnly: true as const,
    };

    expect(isReviewedOriginalBodyBet(reviewed)).toBe(true);
    expect(reviewedOriginalBodyLabel(reviewed)).toBe("원문 추천 · 검토 반영 · EARLY GO");
    expect(isReviewedOriginalBodyBet(bet("native", "2026-10-28T20:00:00Z"))).toBe(false);
    expect(isReviewedOriginalBodyBet(conditional("unknown"))).toBe(false);
    const rows = mergeOverviewBetRows([reviewed], [conditional("unknown")]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.kind).sort()).toEqual(["actionable", "conditional"]);
    expect(conditionalEntrySourceForOverviewRow(rows.find((row) => row.kind === "actionable")!)).toBeNull();
    expect(conditionalEntrySourceForOverviewRow(rows.find((row) => row.kind === "conditional")!))
      .toEqual(conditional("unknown").entrySource);
  });

  it("sorts API-projected bets by start time, keeps future dates, and expires started or invalid rows", () => {
    const rows = upcomingActionableBets([
      bet("tomorrow", "2026-10-28T16:00:00Z"),
      bet("later-today", "2026-10-27T22:00:00Z"),
      bet("already-started", "2026-10-27T17:00:00Z"),
      bet("invalid", "not-a-date"),
    ], new Date("2026-10-27T18:00:00Z"));

    expect(rows.map((row) => row.eventKey)).toEqual(["later-today", "tomorrow"]);
  });

  it("expires a row exactly when its scheduled start is reached", () => {
    expect(upcomingActionableBets([
      bet("at-start", "2026-10-27T18:00:00Z"),
    ], new Date("2026-10-27T18:00:00Z"))).toEqual([]);
  });

  it("preserves recommendation precision and presents reason codes as concise user-facing labels", () => {
    expect(formatSuggestedUnits(0.125)).toBe("0.125U");
    expect(uniqueOverviewReasonLabels(["price_gate_missing_or_invalid", "price_gate_missing_or_invalid", "start_time_missing_or_invalid"]))
      .toEqual(["가격 조건 확인 필요", "경기 시작 시각 확인 필요"]);
    expect(overviewReasonLabel("unknown_internal_reason_code")).toBe("세부 정보 확인 필요");
  });

  it("treats an absent additive conditional field as empty and counts row types separately", () => {
    expect(conditionalBetsOrEmpty(undefined)).toEqual([]);
    expect(overviewRecommendationCounts([bet("exact", "2026-10-27T21:00:00Z")], [conditional("unknown")]))
      .toEqual({ actionable: 1, conditional: 1 });
  });

  it.each([
    ["not_before", "Not before 8:00 PM ET"],
    ["estimated", "Estimated kickoff around 8:00 PM ET"],
    ["date_only", "Saturday schedule"],
    ["unknown", "예정 시각 미확인"],
  ] as const)("preserves %s schedule labels and states timing uncertainty", (precision, label) => {
    const row = conditional(precision, "2026-10-27", label);
    expect(conditionalScheduleDisplay(row.schedule, row.statusAtAssessment)).toEqual({
      expression: label,
      date: "ET 일정 날짜 2026-10-27",
      status: "시각·상태 확인 필요",
      assessmentStatus: "평가 당시 일정 등록",
    });
    expect(row.priceGate).toBe("-110 or better");
    expect(formatSuggestedUnits(row.suggestedUnits)).toBe("0.125U");
  });

  it("expires conditional rows by ET identity date but not when a not-before bound passes", () => {
    const rows = [conditional("not_before", "2026-10-26"), conditional("not_before"), conditional("estimated", "2026-10-28")];
    const current = currentConditionalBets(rows, new Date("2026-10-27T23:00:00Z"));
    expect(current.map((row) => row.schedule.dateEt)).toEqual(["2026-10-27", "2026-10-28"]);
  });

  it("keeps distinct conditional market, price, and units rows distinct", () => {
    const first = conditional("unknown", "2026-10-27", "time TBD");
    const second = { ...first, market: "full-game spread", priceGate: "+3.5 at -105 or better", suggestedUnits: 0.5 };
    const rows = mergeOverviewBetRows([], [first, second]);
    expect(rows).toHaveLength(2);
    expect(overviewRowIdentity(rows[0], 0)).not.toBe(overviewRowIdentity(rows[1], 1));
  });
});
