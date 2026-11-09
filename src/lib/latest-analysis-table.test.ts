import { describe, expect, it } from "vitest";
import { coverageDisplayFromMetadata, evaluationDisplayFromMetadata, extractLatestAnalysisTable, MAX_LATEST_TABLE_CHARS } from "./latest-analysis-table";

describe("evaluationDisplayFromMetadata", () => {
  it("keeps legacy messages absent and reduces malformed metadata to an honest status", () => {
    expect(evaluationDisplayFromMetadata({ original_model_response: "private response" })).toBeNull();
    expect(evaluationDisplayFromMetadata({ evaluation_report: { private: "do not expose" }, evaluation_validation: { private: "do not expose" } })).toEqual({
      report: null,
      quarantinedMarkets: [],
      validation: { version: 1, status: "invalid", reasons: ["evaluation_metadata_invalid"], counts: { valuation_complete: 0, information_wait: 0, research_incomplete: 0, not_evaluated: 0 } },
    });
  });
});

describe("coverageDisplayFromMetadata", () => {
  it("returns only display fields from stored validation metadata", () => {
    expect(coverageDisplayFromMetadata({
      coverage: {
        status: "incomplete",
        scope: {
          version: 1,
          sport: "mlb",
          date_et: "2026-09-30",
          timezone: "America/New_York",
          mode: "daily",
          competitions: ["MLB"],
          basis: "default",
          parent_message_id: "private-message-id",
          notes: ["scope note"],
        },
        listed_count: 4,
        assessed_count: 3,
        missing_event_keys: ["mlb:2026-09-30:game-4"],
        reasons: ["one event was not assessed"],
        audit_snapshot: { secret: "must not leave server" },
      },
      coverage_report: { inventory: [{ source_url: "https://private.example" }] },
      input: "private prompt",
      original_response: "private model response",
    })).toEqual({
      status: "incomplete",
      scope: { date_et: "2026-09-30", competitions: ["MLB"], notes: ["scope note"] },
      listed_count: 4,
      assessed_count: 3,
      missing_event_keys: ["mlb:2026-09-30:game-4"],
      reasons: ["one event was not assessed"],
    });
  });

  it("returns null for old or malformed coverage metadata", () => {
    expect(coverageDisplayFromMetadata({ unrelated: "private" })).toBeNull();
    expect(coverageDisplayFromMetadata({ coverage: { status: "complete" } })).toBeNull();
  });

  it("bounds display scope notes by count and message length", () => {
    const result = coverageDisplayFromMetadata({ coverage: {
      status: "unverified",
      scope: { date_et: "2026-09-30", competitions: ["MLB"], notes: Array.from({ length: 25 }, () => "x".repeat(600)) },
      listed_count: 0,
      assessed_count: 0,
      missing_event_keys: [],
      reasons: [],
    } });

    expect(result?.scope.notes).toHaveLength(20);
    expect(result?.scope.notes[0]).toHaveLength(500);
  });
});

describe("extractLatestAnalysisTable", () => {
  it("extracts a three-column table and keeps the closest heading as its title", () => {
    const result = extractLatestAnalysisTable([
      "# 분석 결론",
      "일반 설명의 | 문자는 표가 아닙니다.",
      "## 경기별 판단",
      "| 경기 | 판단 | 근거 |",
      "| --- | :---: | ---: |",
      "| A vs B | PASS | 선발 미확인 |",
    ].join("\n"));

    expect(result).toEqual({
      analysisTitle: "분석 결론",
      tableContext: "current",
      tableTitle: "경기별 판단",
      tableMarkdown: [
        "| 경기 | 판단 | 근거 |",
        "| --- | :---: | ---: |",
        "| A vs B | PASS | 선발 미확인 |",
      ].join("\n"),
      hasTable: true,
      executionRows: [{ match: "A vs B", startTime: null, decision: "PASS", units: null, unknowns: null, context: "근거: 선발 미확인" }],
    });
  });

  it("ignores fake tables inside fenced code and finds the first real table", () => {
    const result = extractLatestAnalysisTable([
      "# 첫 제목",
      "```markdown",
      "| 가짜 | 표 |",
      "| --- | --- |",
      "| 코드 | 예시 |",
      "```",
      "## 실제 판단",
      "| 경기 | 결과 |",
      "| --- | --- |",
      "| A | PASS |",
    ].join("\n"));

    expect(result.analysisTitle).toBe("첫 제목");
    expect(result.tableTitle).toBe("실제 판단");
    expect(result.tableMarkdown).toContain("| A | PASS |");
  });

  it("ignores four-space-indented code tables", () => {
    const result = extractLatestAnalysisTable([
      "    | 코드 | 예시 |",
      "    | --- | --- |",
      "    | 가짜 | 표 |",
      "| 경기 | 판단 |",
      "| --- | --- |",
      "| A vs B | PASS |",
    ].join("\n"));

    expect(result.tableMarkdown).toBe("| 경기 | 판단 |\n| --- | --- |\n| A vs B | PASS |");
  });

  it("does not treat prose with a pipe as a table", () => {
    const result = extractLatestAnalysisTable("# 제목\nBET | PASS를 검토했지만 표는 없습니다.");

    expect(result).toEqual({
      analysisTitle: "제목",
      tableContext: "unavailable",
      tableTitle: null,
      tableMarkdown: null,
      hasTable: false,
    });
  });

  it("returns display text for Markdown formatted headings", () => {
    const result = extractLatestAnalysisTable("# **신규 BET 없음**\n\n| 경기 | 판단 |\n| --- | --- |");

    expect(result.analysisTitle).toBe("신규 BET 없음");
    expect(result.tableTitle).toBe("신규 BET 없음");
  });

  it("preserves valid GFM body rows with missing or extra cells", () => {
    const result = extractLatestAnalysisTable([
      "| 경기 | 판단 | 근거 |",
      "| --- | --- | --- |",
      "| A vs B | PASS |",
      "| C vs D | BET | 조건 확인 | 추가 정보 |",
    ].join("\n"));

    expect(result.tableMarkdown).toBe([
      "| 경기 | 판단 | 근거 |",
      "| --- | --- | --- |",
      "| A vs B | PASS |",
      "| C vs D | BET | 조건 확인 | 추가 정보 |",
    ].join("\n"));
  });

  it("keeps safe referenced HTTP links used by the extracted table", () => {
    const result = extractLatestAnalysisTable([
      "| 경기 | 출처 |",
      "| --- | --- |",
      "| A vs B | [공식][src] |",
      "",
      "[src]: https://example.com/report \"공식\"",
      "[unused]: https://example.com/unused",
      "[unsafe]: javascript:alert(1)",
    ].join("\n"));

    expect(result.tableMarkdown).toContain("[src]: https://example.com/report");
    expect(result.tableMarkdown).not.toContain("unused");
    expect(result.tableMarkdown).not.toContain("javascript:");
  });

  it("selects a later decision table while excluding source inventory", () => {
    const result = extractLatestAnalysisTable([
      "# 분석 결과",
      "## 라인업 확인",
      "| 경기 | 라인업 재확인 |",
      "| --- | --- |",
      "| A vs B | 선발 발표 전 |",
      "## 경기 판단",
      "| 경기 | 현재 분석 상태 | 권장 유닛 |",
      "| --- | --- | --- |",
      "| A vs B | ML WAIT / 총점 PAPER | 0.25u |",
    ].join("\n"));

    expect(result.tableMarkdown).toContain("| 경기 | 현재 분석 상태 | 권장 유닛 |");
    expect(result.executionRows).toEqual([{
      match: "A vs B",
      startTime: null,
      decision: "ML WAIT / 총점 PAPER",
      units: "0.25u",
      unknowns: null,
    }]);
  });

  it("reports oversized tables without returning a partial Markdown block", () => {
    const result = extractLatestAnalysisTable([
      "| 경기 | 정보 |",
      "| --- | --- |",
      `| A | ${"설명".repeat(MAX_LATEST_TABLE_CHARS)} |`,
    ].join("\n"));

    expect(result.hasTable).toBe(false);
    expect(result.tableMarkdown).toBeNull();
    expect(result.unavailableReason).toBeTruthy();
  });
});

 describe("conservative market roles", () => {
 it("skips timestamp and inventory tables and keeps market context", () => {
 const result = extractLatestAnalysisTable("# Saved\n| 시각 | 확인 |\n| --- | --- |\n| 10:00 | yes |\n## Inventory\n| 경기 | 시작시각 |\n| --- | --- |\n| A | 12:00 |\n## Current markets\n| 경기 | 판단 |\n| --- | --- |\n| A | WAIT |");
 expect(result.tableTitle).toBe("Current markets"); expect(result.tableContext).toBe("current"); expect(result.executionRows).toHaveLength(1);
 });
 it("never turns historical GO into execution rows", () => {
 const result = extractLatestAnalysisTable("# 과거 경기 가상 분석 — 현재 추천 없음\n| 경기 | 판단 | 가격 |\n| --- | --- | --- |\n| Old A | GO | -110 |");
 expect(result.tableContext).toBe("historical"); expect(result.executionRows ?? []).toEqual([]); expect(result.tableMarkdown).toContain("-110");
 });
 it("does not treat inventory as market evaluation", () => {
 const result = extractLatestAnalysisTable("## 전체 일정 inventory\n| 경기 | 시작시각 | 미확인 |\n| --- | --- | --- |\n| A | 12:00 | lineup |");
 expect(result.tableContext).toBe("schedule"); expect(result.executionRows ?? []).toEqual([]);
 });
 });

it("scopes historical labels to sections and retains current market identity", () => {
  const result = extractLatestAnalysisTable("# Current and historical analysis\n## Current markets\n### A at B\n#### Price judgment\nSmall edge depends on a service assumption.\n| Market | Decision |\n| --- | --- |\n| A ML | GO |\n## Historical games\n| Game | Decision |\n| --- | --- |\n| Old C | GO |");
  expect(result.tableContext).toBe("current");
  expect(result.tableMarkdown).toContain("A at B");
  expect(result.tableMarkdown).toContain("service assumption");
  expect(result.tableMarkdown).not.toContain("Old C");
});
