import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketEvaluation } from "./market-evaluation";
import type { EvaluationDisplay } from "@/lib/analysis/evaluation";

const evaluation: EvaluationDisplay = {
  quarantinedMarkets: [],
  validation: { version: 1, status: "valid", reasons: ["critical_check_missing:0:participants"], counts: { valuation_complete: 1, information_wait: 1, research_incomplete: 0, not_evaluated: 0 } },
  report: { version: 1, sport: "nba", date_et: "2026-10-28", scope: "selected_markets", scope_note: "두 선택 시장", truncated: false, markets: [{
    event_key: "nba:2026-10-28:bos@nyk:1", label: "Boston at New York", market: "Spread", selection: "Boston", line: "+3.5", original_decision: "WAIT", state: "information_wait",
    observed_price: { value: "-110", source_url: "https://example.com/price", checked_at: "2026-10-28T10:00:00Z" }, price_condition: "-105 or better", suggested_units: 0.25,
    thesis: "Tempo mismatch favors the visitor.", countercase: "The starter's status may reverse the matchup.", critical_checks: [{ category: "participants", status: "missing", evidence: "Starter not confirmed", source_urls: ["https://example.com/price"], checked_at: null }], uncertainty: { impact: "High", scenario: "Starter sits.", reopen_trigger: "Confirm lineup." },
  }] },
};

describe("MarketEvaluation", () => {
  it("shows selected-market counts, caveat, price distinction, and expandable uncertainty", () => {
    const html = renderToStaticMarkup(createElement(MarketEvaluation, { evaluation }));
    expect(html).toContain("선택한 1개 시장만 포함");
    expect(html).toContain("모델 자체 보고이며 독립 검증된 사실이 아닙니다");
    expect(html).toContain("관측 가격: -110");
    expect(html).toContain("가격 조건: -105 or better");
    expect(html).toContain("확인되지 않음 · participants");
    expect(html).toContain("Confirm lineup.");
    expect(html).toContain("<details class=\"market-evaluation\">");
    expect(html).toContain("주요 선수·출전 정보 점검 누락");
    expect(html).toContain("확인 필요 1");
    expect(html).not.toMatch(/완료 보고 1 · 확인 필요 0/);
  });

  it("shows a compact unavailable notice for invalid reports and nothing for legacy metadata", () => {
    expect(renderToStaticMarkup(createElement(MarketEvaluation, { evaluation: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(MarketEvaluation, { evaluation: { ...evaluation, report: null, validation: { ...evaluation.validation, status: "invalid" } } }))).toContain("시장 평가 정보 확인 불가");
  });

  it("does not link unsafe sources", () => {
    const unsafe = structuredClone(evaluation);
    unsafe.report!.markets[0].observed_price!.source_url = "javascript:alert(1)";
    const html = renderToStaticMarkup(createElement(MarketEvaluation, { evaluation: unsafe }));
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("가격 출처");
  });

  it("shows price-less PASS and canonical conflicts as item-specific warnings", () => {
    const conflict = structuredClone(evaluation);
    conflict.report!.markets.push({
      ...conflict.report!.markets[0], event_key: "nba:2026-10-28:bos@nyk:2", market: "Moneyline", selection: "Boston", line: null,
      original_decision: "PASS", state: "valuation_complete", observed_price: null, countercase: "",
      critical_checks: [],
    });
    conflict.validation.counts.valuation_complete = 2;
    conflict.validation.reasons.push("valuation_price_missing:1", "canonical_decision_conflict:1", "canonical_price_conflict:1");
    conflict.report!.markets.push({ ...conflict.report!.markets[1], event_key: "nba:2026-10-28:bos@nyk:3", original_decision: "WATCH", market: "Total", selection: "Under", countercase: "There is a plausible countercase." });
    conflict.validation.counts.valuation_complete = 3;
    conflict.validation.reasons.push("valuation_price_missing:2");
    const html = renderToStaticMarkup(createElement(MarketEvaluation, { evaluation: conflict }));
    expect(html).toContain("완료 보고 · 보완 필요");
    expect(html).toContain("완료 보고에 관측 가격이 없음");
    expect(html).toContain("WATCH");
    expect(html).toContain("저장된 판단·가격 조건과 보고 내용이 다름");
    expect(html).toContain("반대 근거가 비어 있음");
    expect(html).toContain("확인 필요 3");
    expect(html).toContain("(완료 보고 중 2건)");
  });
});

 it("distinguishes missing machine block, schema details, partial source quarantine, and historical display", () => {
 expect(renderToStaticMarkup(createElement(MarketEvaluation, { evaluation: null, savedBodyExists: true }))).toContain("저장된 분석 본문은 있지만");
 const partial = structuredClone(evaluation); partial.validation.status = "partial"; partial.quarantinedMarkets = [{originalIndex:0,label:"Uncertified A",market:"ML",selection:"A",originalDecision:"GO",reasons:["source_url_unknown:0"]}];
 const html = renderToStaticMarkup(createElement(MarketEvaluation, { evaluation: partial })); expect(html).toContain("Uncertified A"); expect(html).toContain("일부 시장은 출처·형식 확인이 필요하여 제외"); expect(html).toContain("Boston at New York");
 const absent = structuredClone(evaluation); absent.report = null; absent.validation.status = "unavailable"; absent.validation.reasons = ["evaluation_report_absent"];
 expect(renderToStaticMarkup(createElement(MarketEvaluation, {evaluation: absent}))).toContain("구조화된 시장 평가 블록이 없습니다");
 const invalid = structuredClone(evaluation); invalid.report = null; invalid.validation.status="invalid"; invalid.validation.details=[{code:"invalid_type",path:"markets.0.line",message:"Expected string"}];
 expect(renderToStaticMarkup(createElement(MarketEvaluation,{evaluation:invalid}))).toContain("markets.0.line");
 expect(renderToStaticMarkup(createElement(MarketEvaluation, {evaluation:null,presentation:{context:"historical",reason:"Historical saved analysis"},savedBodyExists:true}))).toContain("현재 추천을 만들지 않습니다");
 });
