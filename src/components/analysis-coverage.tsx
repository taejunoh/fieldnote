import { createElement } from "react";
import type { CoverageDisplay } from "@/lib/latest-analysis-table";
import { formatCoverageReason } from "../lib/analysis/coverage-labels";

const statusLabel: Record<CoverageDisplay["status"], string> = {
  complete: "일정 목록 처리 완료",
  incomplete: "일정 목록 처리 미완료",
  unverified: "일정 목록 독립 검증 안 됨",
};

export function AnalysisCoverage({ coverage }: { coverage: CoverageDisplay | null }) {
  if (!coverage) return createElement("div", { className: "analysis-coverage-missing" }, "범위 검증 정보 없음");
  const details = [...new Set([
    ...coverage.reasons.map(formatCoverageReason),
    ...coverage.scope.notes.map(formatCoverageReason),
    ...coverage.missing_event_keys.map((key) => `미확인 경기: ${key}`),
  ])];

  return createElement("section", {
    className: `analysis-coverage analysis-coverage-${coverage.status}`,
    "aria-label": "일정 목록 처리 현황",
  },
  createElement("div", { className: "analysis-coverage-scope" },
    createElement("span", null, `${coverage.scope.date_et} ET`),
    createElement("span", null, coverage.scope.competitions.length > 0
      ? coverage.scope.competitions.join(" · ")
      : "대회 범위 미확정"),
  ),
  createElement("div", { className: "analysis-coverage-summary" },
    createElement("span", null, `일정 목록 ${coverage.listed_count}개 · 처리 ${coverage.assessed_count}개`),
    createElement("b", null, statusLabel[coverage.status]),
  ),
  coverage.status !== "complete" && details.length > 0
    ? createElement("details", { className: "analysis-coverage-details" },
      createElement("summary", null, coverage.status === "incomplete" ? "미완료 사유" : "확인 필요 사항"),
      createElement("ul", null, ...details.map((reason, index) => createElement("li", { key: `${index}-${reason}` }, reason))),
    )
    : null,
  );
}
