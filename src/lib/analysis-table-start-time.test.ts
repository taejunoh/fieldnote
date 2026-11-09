import { describe, expect, it } from "vitest";
import {
  hasMatchStartTimeColumn,
  shouldShowMissingMatchStartTime,
} from "./analysis-table-start-time";

describe("match table start time headers", () => {
  it.each([
    "| 경기 | 경기 시작 시각 | 분석 |\n|---|---|---|\n| A vs B | 8:15 PM ET | 내용 |",
    "| Matchup | Kickoff (ET) | Pick |\n|---|---|---|\n| A vs B | 8:15 PM | A |",
    "| Match | Start Time | Selection |\n|---|---|---|\n| A vs B | 8:15 PM | A |",
    "| Match | Time (ET) | Pick |\n|---|---|---|\n| A vs B | 8:15 PM | A |",
    "| Match | Date & Time | Pick |\n|---|---|---|\n| A vs B | 2026-09-28 8:15 PM | A |",
    "Matchup | Start Time | Pick\n---|---|---\nA vs B | 8:15 PM | A",
    "Matchup | 경기 시작 시각 | 추천\n---|---|---\nA vs B | 오후 8:15 | A",
  ])("detects a start time column in %s", (markdown) => {
    expect(hasMatchStartTimeColumn(markdown)).toBe(true);
  });

  it.each([
    "| Matchup | Pick | Reason |\n|---|---|---|\n| A vs B | A | Edge |",
    "| 경기 | 추천 | 근거 |\n|---|---|---|\n| A vs B | A | 우세 |",
    "| 경기 | 확인 시각 | 추천 |\n|---|---|---|\n| A vs B | 오후 7:00 | A |",
  ])("does not detect a missing start time in %s", (markdown) => {
    expect(hasMatchStartTimeColumn(markdown)).toBe(false);
  });

  it("shows the note only for match analysis and lineup rechecks without a time column", () => {
    const markdown = "| Matchup | Pick |\n|---|---|\n| A vs B | A |";

    expect(shouldShowMissingMatchStartTime("analyze_today", markdown)).toBe(true);
    expect(shouldShowMissingMatchStartTime("recheck_lineup", markdown)).toBe(true);
    expect(shouldShowMissingMatchStartTime("check_status", markdown)).toBe(false);
    expect(shouldShowMissingMatchStartTime("review_results", markdown)).toBe(false);
    expect(
      shouldShowMissingMatchStartTime(
        "analyze_today",
        "| Match | Start Time |\n|---|---|\n| A vs B | 8:15 PM |",
      ),
    ).toBe(false);
  });

  it.each([
    [
      "NFL market table",
      "| 우선순위 | 시장·선택 | 이번에 확인한 공개 가격 | 현재 판단 | 권장 유닛 |\n|---|---|---|---|---|\n| 1 | Team A | -110 | 우세 | 1 |",
      true,
    ],
    [
      "tennis match table",
      "| 경기 | 판단 | 검토 방향 | 매수가 | 유닛 | Full Agreement? |\n|---|---|---|---|---|---|\n| Player A vs Player B | 우세 | 확인 | 1.90 | 1 | yes |",
      true,
    ],
    [
      "MLB summary table",
      "| 항목 | 처리 |\n|---|---|\n| 선발 | 확인 |",
      false,
    ],
    [
      "CFB schedule summary table",
      "| 확인 범위 | 오늘 일정 | 다음 경기일 |\n|---|---|---|\n| 공개 일정 | 없음 | 10월 1일 |",
      false,
    ],
  ])("requires match or market rows for %s", (_label, markdown, expected) => {
    expect(shouldShowMissingMatchStartTime("analyze_today", markdown)).toBe(expected);
  });
});
