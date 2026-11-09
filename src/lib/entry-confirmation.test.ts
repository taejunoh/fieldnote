import { describe, expect, it } from "vitest";
import { isEntryConfirmationAcknowledgment } from "./entry-confirmation";

describe("isEntryConfirmationAcknowledgment", () => {
  it.each([
    "들어갔어",
    "들어갔어요",
    "진입했어",
    "진입했어요",
    "베팅했어",
    "베팅했어요",
    "진입 완료",
    "베팅 완료",
    "  진입   완료!  ",
    "들어갔어.",
    "\ufeff베팅했어요",
  ])("accepts a complete normalized acknowledgment: %s", (text) => {
    expect(isEntryConfirmationAcknowledgment(text)).toBe(true);
  });

  it.each([
    "오늘 경기 분석해줘",
    "오늘 경기 들어갔어",
    "들어갔어, 오늘 경기 분석해줘",
    "들어갔어 - 양키스 ML -110",
    "PASS",
    "추천은 베팅했어",
    "이미 들어갔어",
    "들어갔어?",
    "경기 진입 완료",
    "들어\u200b갔어",
  ])("rejects analysis, recommendation, or mixed text: %s", (text) => {
    expect(isEntryConfirmationAcknowledgment(text)).toBe(false);
  });
});
