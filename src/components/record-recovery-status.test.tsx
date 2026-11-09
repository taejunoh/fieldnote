import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecordRecoveryStatus } from "./record-recovery-status";

describe("RecordRecoveryStatus", () => {
  it("shows original check time and separate schedule verification time", () => {
    const html = renderToStaticMarkup(createElement(RecordRecoveryStatus, { recovery: {
      status: "repaired",
      originalCheckedAt: "2026-10-23T14:05:29.255Z",
      repairedAt: "2026-10-23T18:00:00Z",
      sourceVerifiedAt: "2026-10-23T17:08:14.691419+00:00",
      sourceVerificationScope: "schedule_pair_and_date",
      eventCount: 8,
      recommendationCount: 20,
    } }));
    expect(html).toContain("분석 기록 반영 완료");
    expect(html).toContain("원 분석 확인");
    expect(html).toContain("대진·경기일 추가 확인");
    expect(html).toContain("2026. 10. 23.");
  });

  it("keeps repaired status when original time is missing and hides unverified source status", () => {
    const html = renderToStaticMarkup(createElement(RecordRecoveryStatus, { recovery: {
      status: "repaired",
      originalCheckedAt: null,
      repairedAt: "2026-10-23T18:00:00Z",
      sourceVerifiedAt: null,
      sourceVerificationScope: null,
      eventCount: 2,
      recommendationCount: 13,
    } }));
    expect(html).toContain("분석 기록 반영 완료");
    expect(html).toContain("시각 정보 없음");
    expect(html).not.toContain("대진·경기일 추가 확인");
  });
});

describe("partial record status", () => {
  const partial = {
    status: "partial" as const, originalCheckedAt: "2026-10-27T15:48:21.000Z", repairedAt: null as string | null,
    sourceVerifiedAt: null, sourceVerificationScope: null, eventCount: 6, recommendationCount: 12,
    inputEventCount: 8, inputRecommendationCount: 14, rejectedEventCount: 2, rejectedRecommendationCount: 2,
    rejectedReasons: ["unverified_source" as const, "unofficial_source" as const, "uncited_source" as const],
  };
  it("shows normal partial counts and distinct source-admission reasons", () => {
    const html = renderToStaticMarkup(createElement(RecordRecoveryStatus, { recovery: partial }));
    expect(html).toContain("분석 기록 일부 저장");
    expect(html).toContain("경기 6/8");
    expect(html).toContain("추천 12/14");
    expect(html).toContain("이번 검색 출처 목록에 없음");
    expect(html).toContain("등록된 일정 출처 요건 미충족");
    expect(html).toContain("본문의 동일 URL 인용 누락");
    expect(html).not.toContain("분석 기록 반영 완료");
    expect(html).not.toContain("복구 처리");
  });
  it("separates historical extraction warning from current repaired subset and repair time", () => {
    const html = renderToStaticMarkup(createElement(RecordRecoveryStatus, { recovery: { ...partial, repairedAt: "2026-10-27T17:00:00.000Z" } }));
    expect(html).toContain("분석 기록 일부 복구");
    expect(html).toContain("원 분석 확인");
    expect(html).toContain("복구 처리");
    expect(html).toContain("원문 속 추출 경고는 당시 상태");
    expect(html).not.toContain("분석 기록 반영 완료");
  });
});
