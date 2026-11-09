import { createElement } from "react";
import type { RecordRecoveryDTO } from "@/lib/record-recovery";

function displayTime(value: string | null): string {
  if (!value) return "시각 정보 없음";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "시각 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date) + " ET";
}

export function RecordRecoveryStatus({ recovery }: { recovery?: RecordRecoveryDTO | null }) {
  if (!recovery) return null;
  if (recovery.status === "partial") {
    const reasons = {
      unverified_source: "이번 검색 출처 목록에 없음",
      unofficial_source: "등록된 일정 출처 요건 미충족",
      uncited_source: "본문의 동일 URL 인용 누락",
    };
    return createElement("div", { className: "record-recovery-status", "aria-label": "분석 기록 부분 반영 상태" },
      createElement("span", null, `${recovery.repairedAt ? "분석 기록 일부 복구" : "분석 기록 일부 저장"} · 경기 ${recovery.eventCount}/${recovery.inputEventCount} · 추천 ${recovery.recommendationCount}/${recovery.inputRecommendationCount}`),
      createElement("span", null, `원 분석 확인 ${displayTime(recovery.originalCheckedAt)}`),
      recovery.repairedAt ? createElement("span", null, `복구 처리 ${displayTime(recovery.repairedAt)}`) : null,
      createElement("span", null, `제외: 경기 ${recovery.rejectedEventCount} · 연결 추천 ${recovery.rejectedRecommendationCount} — ${recovery.rejectedReasons.map(code => reasons[code]).join(" · ")}`),
      recovery.repairedAt ? createElement("span", null, "원문 속 추출 경고는 당시 상태이며, 현재 반영 범위는 위 건수입니다.") : null,
    );
  }
  return createElement("div", { className: "record-recovery-status", "aria-label": "분석 기록 복구 상태" },
    createElement("span", null, `분석 기록 반영 완료 · 원 분석 확인 ${displayTime(recovery.originalCheckedAt)}`),
    recovery.sourceVerificationScope === "schedule_pair_and_date" && recovery.sourceVerifiedAt
      ? createElement("span", null, `대진·경기일 추가 확인 · ${displayTime(recovery.sourceVerifiedAt)}`)
      : null,
  );
}
