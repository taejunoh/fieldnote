import { describe, expect, it } from "vitest";

import { compactPriceCondition, formatCheckedAtEt } from "./price-condition-display";

describe("overview price condition display", () => {
  it.each([
    ["-110 이상", "total"],
    ["-110 이하", "total"],
    ["-110 미만", "unknown"],
    ["-110 초과", "unknown"],
  ])("does not treat %s as American odds for market %s", (priceGate, market) => {
    expect(compactPriceCondition(priceGate, market).summary).toBe("조건 확인");
  });

  it.each([
    ["08:00 EDT BetUS -146. 허용 -150 또는 더 유리한 가격·연장 포함. 실제 체결 미확인.", "moneyline", "-150 이상"],
    ["+3/-110 또는 더 좋은 배당. +2.5/+100은 PASS. 공개 페이지 간 표시 차이·실제 제공 여부 별도 확인.", "spread", "+3 · -110 이상"],
    ["MIL +8.5에서 American -110 또는 더 좋은 가격. 기준점이 낮아지면 같은 추천을 자동 이전하지 않는다.", "spread", "+8.5 · -110 이상"],
    ["NOP +5.5에서 American -115 또는 더 좋은 가격.", "spread", "+5.5 · -115 이상"],
    ["Nashville ML -133 또는 더 좋은 가격", "moneyline", "-133 이상"],
    ["+180 이상. Cooley–Jarry 확인 전.", "moneyline", "+180 이상"],
    ["미국식 +136 이상", "moneyline", "+136 이상"],
  ])("compacts an exact source condition: %s", (priceGate, market, summary) => {
    expect(compactPriceCondition(priceGate, market).summary).toBe(summary);
  });

  it("uses the explicitly allowed price instead of the observed quote", () => {
    expect(compactPriceCondition(
      "08:00 EDT BetUS -146. 허용 -150 또는 더 유리한 가격·연장 포함. 실제 체결 미확인.",
      "moneyline",
    )).toEqual({ summary: "-150 이상", disclosure: "08:00 EDT BetUS -146. 허용 -150 또는 더 유리한 가격·연장 포함. 실제 체결 미확인." });
  });

  it("keeps handicap and American odds distinct and ignores an excluded line", () => {
    expect(compactPriceCondition("+3/-110 or better. +2.5/+100은 PASS", "spread"))
      .toMatchObject({ summary: "+3 · -110 이상" });
    expect(compactPriceCondition("+8.5 at American -110 or better", "spread").summary)
      .toBe("+8.5 · -110 이상");
    expect(compactPriceCondition("+5.5 at -115 or better", "spread").summary)
      .toBe("+5.5 · -115 이상");
    expect(compactPriceCondition("+180 or better", "moneyline").summary).toBe("+180 이상");
    expect(compactPriceCondition("-133 이상", "moneyline").summary).toBe("-133 이상");
    expect(compactPriceCondition("+136 이상", "moneyline").summary).toBe("+136 이상");
  });

  it("keeps decimal conversion and fails closed on ambiguity", () => {
    expect(compactPriceCondition("2.04 or better", "moneyline").summary).toBe("+104 이상");
    expect(compactPriceCondition("1.91 or better", "moneyline").summary).toBe("약 -109.89 이상");
    expect(compactPriceCondition("+3 at -110 or better; total 45.5 at -110", "spread").summary)
      .toBe("조건 확인");
    expect(compactPriceCondition("+3/-110 or better; total 45.5 at -110 is PASS", "spread").summary)
      .toBe("조건 확인");
    expect(compactPriceCondition("+8.5 -110 or better", "spread").summary).toBe("조건 확인");
    expect(compactPriceCondition("ML observed -146, total 45.5 at -110 or better", "moneyline").summary)
      .toBe("조건 확인");
    expect(compactPriceCondition("허용 -150 이하 또는 +3/-110 or better", "moneyline").summary)
      .toBe("조건 확인");
    expect(compactPriceCondition("+3/-110 or better. +2.5/+100은 PASS, total 45.5 at -110 or better", "spread").summary)
      .toBe("조건 확인");
    expect(compactPriceCondition("MIL +8.5에서 American -110 또는 더 좋은 가격. +4.5로 내려가면 같은 추천을 자동 이전하지 않는다.", "spread").summary)
      .toBe("+8.5 · -110 이상");
    expect(compactPriceCondition("+3.5", "spread").summary).toBe("조건 확인");
  });
});

describe("checked time in New York", () => {
  it("formats 24-hour ET across daylight-saving offsets", () => {
    expect(formatCheckedAtEt("2026-10-28T12:04:00Z")).toBe("10/28 08:04 ET");
    expect(formatCheckedAtEt("2026-01-28T13:04:00Z")).toBe("01/28 08:04 ET");
    expect(formatCheckedAtEt("2026-10-28T08:04:00-04:00")).toBe("10/28 08:04 ET");
    expect(formatCheckedAtEt("2026-10-28")).toBe("시각 미확인");
    expect(formatCheckedAtEt("2026-10-28T08:04:00")).toBe("시각 미확인");
  });

  it("does not invent a time for invalid input", () => {
    expect(formatCheckedAtEt("not-a-time")).toBe("시각 미확인");
  });
});
