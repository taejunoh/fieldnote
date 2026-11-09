import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisMessage } from "./analysis-message";
import type { EvaluationDisplay } from "@/lib/analysis/evaluation";

const supplements = [
  {
    event_key: "nhl:2026-10-18:bos@nyr:fixture-1",
    label: "Boston & New York",
    source_url: "https://www.nhl.com/scores/2026-10-18",
    reason: "original_inventory_citation",
  },
  {
    event_key: "nhl:2026-10-18:sea@van:fixture-2",
    label: "Seattle at Vancouver",
    source_url: "https://www.nhl.com/scores/2026-10-18?team=sea",
    reason: "original_inventory_citation",
  },
];

const render = (content: string, repairCitationSupplements?: unknown) =>
  renderToStaticMarkup(createElement(AnalysisMessage, {
    content,
    ...(repairCitationSupplements === undefined ? {} : { repairCitationSupplements }),
  }));

describe("AnalysisMessage repair citation supplements", () => {
  it("shows validated repair links and the notice alongside the original message", () => {
    const html = render("Original analysis", supplements);

    expect(html).toContain("Original analysis");
    expect(html).toContain("기록 복구 출처 보완");
    expect(html).toContain("원래 경기 목록에 연결된 출처를 복구 과정에서 보완했습니다.");
    expect(html).toContain('href="https://www.nhl.com/scores/2026-10-18" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Boston &amp; New York");
    expect(html).toContain("Seattle at Vancouver");
    expect(html).not.toContain("fixture-1");
  });

  it("omits the supplement section when the metadata value is absent or empty", () => {
    expect(render("No repair metadata")).not.toContain("기록 복구 출처 보완");
    expect(render("Empty repair metadata", [])).not.toContain("기록 복구 출처 보완");
  });

  it("ignores malformed records and unsafe or non-HTTPS URLs", () => {
    const html = render("Original analysis", [
      ...supplements,
      { ...supplements[0], label: "<img src=x>", source_url: "javascript:alert(1)" },
      { ...supplements[0], label: "Bad reason", reason: "other" },
      { ...supplements[0], label: "User info", source_url: "https://user@example.com/source" },
      { ...supplements[0], label: "Nondefault port", source_url: "https://example.com:8443/source" },
      { ...supplements[0], label: "Malformed URL", source_url: "https:example.com/source" },
      { ...supplements[0], label: "" },
      null,
    ]);

    expect(html).toContain("Boston &amp; New York");
    expect(html).toContain("Seattle at Vancouver");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Bad reason");
    expect(html).not.toContain("User info");
    expect(html).not.toContain("Nondefault port");
    expect(html).not.toContain("Malformed URL");
    expect(html).not.toContain("<img");
  });

  it("preserves the existing parsed body and source footer when supplements are present", () => {
    const content = "Original body\n\n---\n자료 확인 시각: 2026-10-18 12:00:00 (America/New_York)\n출처: [NHL](https://www.nhl.com/scores)\n미확인 사항: 없음";
    const html = render(content, supplements);

    expect(html).toContain("Original body");
    expect(html).toContain("출처 1개 보기");
    expect(html).toContain("자료 확인 시각: 2026-10-18 12:00:00 (America/New_York)");
    expect(html).toContain("기록 복구 출처 보완");
  });

  it("shows supplements when the message footer cannot be parsed", () => {
    const html = render("Plain answer with an ambiguous footer\n\n---\n출처: [broken](javascript:alert(1))", supplements);

    expect(html).toContain("Plain answer with an ambiguous footer");
    expect(html).toContain("기록 복구 출처 보완");
  });
});

it("shows current partial recovery beside the preserved historical warning", () => {
  const original = "Original analysis\n\n구조화 기록 추출 미완료; 분석 원문만 저장됨.";
  const html = renderToStaticMarkup(createElement(AnalysisMessage, { content: original, recovery: {
    status: "partial", originalCheckedAt: "2026-10-27T15:48:21.000Z", repairedAt: "2026-10-27T17:00:00.000Z",
    sourceVerifiedAt: null, sourceVerificationScope: null, eventCount: 6, recommendationCount: 12,
    inputEventCount: 8, inputRecommendationCount: 14, rejectedEventCount: 2, rejectedRecommendationCount: 2,
    rejectedReasons: ["unverified_source"],
  } }));
  expect(html).toContain("분석 기록 일부 복구");
  expect(html).toContain("원문 속 추출 경고는 당시 상태");
  expect(html).toContain("구조화 기록 추출 미완료; 분석 원문만 저장됨.");
  expect(html).toContain("Original analysis");
});

it("shows evaluation only on analysis messages and leaves ordinary conversation unbadged", () => {
  const evaluation: EvaluationDisplay = { quarantinedMarkets: [], report: null, validation: { version: 1, status: "invalid", reasons: ["bad"], counts: { valuation_complete: 0, information_wait: 0, research_incomplete: 0, not_evaluated: 0 } } };
  const analysis = renderToStaticMarkup(createElement(AnalysisMessage, { content: "Analysis", evaluation }));
  const conversation = renderToStaticMarkup(createElement(AnalysisMessage, { content: "Chat", type: "conversation", evaluation }));
  expect(analysis).toContain("시장 평가 정보 확인 불가");
  expect(conversation).not.toContain("시장 평가 정보 확인 불가");
});
