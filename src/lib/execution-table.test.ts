import { describe, expect, it } from "vitest";
import { extractExecutionRows } from "./execution-table";

describe("extractExecutionRows", () => {
  it("normalizes known Korean and English headers without inventing missing values", () => {
    const rows = extractExecutionRows([
      "```markdown",
      "| 경기 | 판단 |",
      "| --- | --- |",
      "| 가짜 경기 | BET |",
      "```",
      "| Matchup | Start Time (ET) | Current Analysis Status | Recommended Units | Unknown Items |",
      "| --- | --- | --- | --- | --- |",
      "| **ATL vs. NYM** | 7:10 PM | 당시 ATL WATCH 보존 → EVALUATION INCOMPLETE | 0.5u | 선발 *미확인* |",
    ].join("\n"));

    expect(rows).toEqual([{
      match: "**ATL vs. NYM**",
      startTime: "7:10 PM",
      decision: "당시 ATL WATCH 보존 → EVALUATION INCOMPLETE",
      units: "0.5u",
      unknowns: "선발 *미확인*",
    }]);
  });

  it("unions supported tables without joining historical and upcoming rows", () => {
    const rows = extractExecutionRows([
      "| 경기 | 현재 분석 상태 |",
      "| --- | --- |",
      "| A vs B | ML·총점 WAIT |",
      "| C vs D | ML WAIT / 저득점 PAPER |",
      "",
      "| Matchup | Start Time (ET) | Unknowns |",
      "| --- | --- | --- |",
      "| A vs B | 7:00 PM | 선발 확인 중 |",
      "| C vs D | 8:00 PM | |",
      "| E vs F | 9:00 PM | 별도 경기 |",
    ].join("\n"));

    expect(rows).toEqual([
      { match: "A vs B", startTime: null, decision: "ML·총점 WAIT", units: null, unknowns: null },
      { match: "C vs D", startTime: null, decision: "ML WAIT / 저득점 PAPER", units: null, unknowns: null },
      { match: "A vs B", startTime: "7:00 PM", decision: null, units: null, unknowns: "선발 확인 중" },
      { match: "C vs D", startTime: "8:00 PM", decision: null, units: null, unknowns: null },
      { match: "E vs F", startTime: "9:00 PM", decision: null, units: null, unknowns: "별도 경기" },
    ]);
  });

  it("keeps duplicate markets, contradictory judgments, and all supplemental rows", () => {
    const rows = extractExecutionRows([
      "| 경기 | 판단 | 시장 선택 |",
      "| --- | --- | --- |",
      "| A vs B | ML WAIT | 홈 ML |",
      "| A vs B | 저득점 PAPER | 언더 |",
      "",
      "| Match | Decision |",
      "| --- | --- |",
      "| A vs B | BET |",
    ].join("\n"));

    expect(rows.map(({ match, decision }) => [match, decision])).toEqual([
      ["A vs B", "ML WAIT"],
      ["A vs B", "저득점 PAPER"],
      ["A vs B", "BET"],
    ]);
    expect(rows.slice(0, 2).map(({ context }) => context)).toEqual(["시장 선택: 홈 ML", "시장 선택: 언더"]);
    expect(rows.every(({ startTime }) => startTime === null)).toBe(true);
  });

  it("preserves a conflicting exact-match row instead of overwriting the base judgment", () => {
    const rows = extractExecutionRows([
      "| 경기 | 판단 |",
      "| --- | --- |",
      "| A vs B | WAIT |",
      "",
      "| Matchup | Decision |",
      "| --- | --- |",
      "| A vs B | BET |",
    ].join("\n"));

    expect(rows.map(({ decision }) => decision)).toEqual(["WAIT", "BET"]);
  });

  it("marks an unqualified source time instead of assuming ET", () => {
    expect(extractExecutionRows([
      "| 경기 | 판단 | 시작 시각 |",
      "| --- | --- | --- |",
      "| A vs B | WAIT | 7:00 PM |",
    ].join("\n"))[0].startTime).toBe("7:00 PM (미기재 시간대)");
  });

  it("keeps non-recommended stake units in row context", () => {
    expect(extractExecutionRows([
      "| 경기 | 판단 | Units |",
      "| --- | --- | --- |",
      "| A vs B | WAIT | 1u |",
    ].join("\n"))[0]).toEqual({
      match: "A vs B",
      startTime: null,
      decision: "WAIT",
      units: null,
      unknowns: null,
      context: "Units: 1u",
    });
  });

  it("preserves a KST source qualifier", () => {
    expect(extractExecutionRows([
      "| 경기 | 판단 | 시작 시각 (KST) |",
      "| --- | --- | --- |",
      "| A vs B | WAIT | 7:00 PM |",
    ].join("\n"))[0].startTime).toBe("7:00 PM (KST 시간대)");
  });

  it("preserves code and safe reference links containing pipe characters", () => {
    const row = extractExecutionRows([
      "| 경기 | 판단 | 근거 |",
      "| --- | --- | --- |",
      "| `ATL | NYM` vs BOS | WAIT | [기록][source] |",
      "",
      "[source]: https://example.com/report \"공식\"",
    ].join("\n"))[0];

    expect(row.match).toBe("`ATL | NYM` vs BOS");
    expect(row.context).toBe('근거: [기록](https://example.com/report "공식")');
  });

  it("does not normalize unsupported or non-table content", () => {
    expect(extractExecutionRows("# Analysis\nA vs B might be a good matchup.")).toEqual([]);
    expect(extractExecutionRows("| 경기 | 결과 |\n| --- | --- |\n| A vs B | 승리 |" )).toEqual([]);
  });

  it.each(["목적", "검토 목적", "purpose"])("extracts 경기 + %s as context without treating purpose as a judgment", (header) => {
    expect(extractExecutionRows([
      `| 경기 | ${header} |`,
      "| --- | --- |",
      "| A vs B | 선발투수 영향 검토 |",
    ].join("\n"))).toEqual([
      {
        match: "A vs B",
        startTime: null,
        decision: null,
        units: null,
        unknowns: null,
        context: `${header}: 선발투수 영향 검토`,
      },
    ]);
    expect(extractExecutionRows("| 상태 | 목적 |\n| --- | --- |\n| LIVE | 선발 검토 |" )).toEqual([]);
  });
});
