import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisCoverage } from "./analysis-coverage";

describe("AnalysisCoverage", () => {
  it("shows the exact fallback when older analyses have no coverage", () => {
    expect(renderToStaticMarkup(createElement(AnalysisCoverage, { coverage: null }))).toContain("범위 검증 정보 없음");
  });

  it("shows compact scope and assessment counts for unverified schedules", () => {
    const html = renderToStaticMarkup(createElement(AnalysisCoverage, { coverage: {
      status: "unverified",
      scope: { date_et: "2026-09-30", competitions: ["MLB", "WNBA"], notes: [] },
      listed_count: 12,
      assessed_count: 10,
      missing_event_keys: ["mlb:game-1"],
      reasons: ["공식 일정 전체를 독립 수집하지 못함"],
    } }));

    expect(html).toContain("2026-09-30 ET");
    expect(html).toContain("MLB · WNBA");
    expect(html).toContain("일정 목록 12개 · 처리 10개");
    expect(html).toContain("일정 목록 독립 검증 안 됨");
  });

  it("keeps incomplete coverage reasons inside a collapsed disclosure", () => {
    const html = renderToStaticMarkup(createElement(AnalysisCoverage, { coverage: {
      status: "incomplete",
      scope: { date_et: "2026-09-30", competitions: ["NFL"], notes: [] },
      listed_count: 3,
      assessed_count: 2,
      missing_event_keys: ["nfl:game-3"],
      reasons: ["경기 1개가 평가되지 않음"],
    } }));

    expect(html).toContain("일정 목록 처리 미완료");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("경기 1개가 평가되지 않음");
    expect(html).toContain("nfl:game-3");
  });

  it("shows translated verification details for unverified scope warnings and empty competitions", () => {
    const html = renderToStaticMarkup(createElement(AnalysisCoverage, { coverage: {
      status: "unverified",
      scope: { date_et: "2026-09-30", competitions: [], notes: ["invalid_or_ambiguous_request_date"] },
      listed_count: 0,
      assessed_count: 0,
      missing_event_keys: [],
      reasons: ["coverage_report_absent", "competition_scope_unknown", "independent_schedule_verification_unavailable"],
    } }));

    expect(html).toContain("대회 범위 미확정");
    expect(html).toContain("<details");
    expect(html).toContain("확인 필요 사항");
    expect(html).toContain("일정 범위를 확인할 검증 보고서가 없습니다.");
    expect(html).toContain("대회 범위를 확인하지 못했습니다.");
    expect(html).toContain("요청 날짜가 없거나 모호해 확인이 필요합니다.");
    expect(html).not.toContain("coverage_report_absent");
    expect(html).not.toContain("invalid_or_ambiguous_request_date");
  });
});
