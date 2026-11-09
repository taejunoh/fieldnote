import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExecutionTable } from "./execution-table";

describe("ExecutionTable", () => {
  it("renders the standard columns, source links, missing values, and only standalone status badges", () => {
    const html = renderToStaticMarkup(createElement(ExecutionTable, {
      rows: [
        {
          match: "[ATL vs. NYM](https://example.com/game)",
          startTime: null,
          decision: "PASS",
          units: null,
          unknowns: "선발 확인 필요",
        },
        {
          match: "B vs C",
          startTime: "8:00 PM",
          decision: "신규 BET 없음",
          units: "0.5u",
          unknowns: null,
        },
        {
          match: "D vs E",
          startTime: null,
          decision: "**BET**",
          units: null,
          unknowns: null,
        },
        {
          match: "F vs G",
          startTime: null,
          decision: "[BET](https://example.com/bet)",
          units: null,
          unknowns: null,
        },
      ],
    }));

    expect(html).toContain('class="execution-table"');
    expect(html).toContain("경기");
    expect(html).toContain("시작 시각(ET)");
    expect(html).toContain("권장 유닛");
    expect(html).toContain('class="status-badge status-pass"');
    expect(html).toContain('class="status-badge status-bet"');
    expect(html).toContain('href="https://example.com/game" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('href="https://example.com/bet" target="_blank" rel="noopener noreferrer"');
    expect(html).not.toContain("**BET**");
    expect(html).toContain("미기재");
    expect(html.match(/class="status-badge status-bet"/g)).toHaveLength(2);
  });
});
