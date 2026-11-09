const reasonLabels: [string, string][] = [
  ["coverage_report_absent", "일정 범위를 확인할 검증 보고서가 없습니다."],
  ["coverage_block_unclosed", "검증 보고서가 끝까지 전달되지 않았습니다."],
  ["multiple_coverage_blocks", "검증 보고서가 여러 개 포함되어 범위를 확인하지 못했습니다."],
  ["coverage_block_too_large", "검증 보고서가 너무 커서 확인하지 못했습니다."],
  ["coverage_invalid_json", "검증 보고서 형식을 읽을 수 없습니다."],
  ["coverage_invalid_schema", "검증 보고서에 필요한 정보가 빠져 있습니다."],
  ["coverage_scope_mismatch", "검증 보고서의 종목·날짜·대회 범위가 요청과 다릅니다."],
  ["competition_scope_unknown", "대회 범위를 확인하지 못했습니다."],
  ["invalid_or_ambiguous_request_date", "요청 날짜가 없거나 모호해 확인이 필요합니다."],
  ["event_scope_mismatch", "요청한 날짜 범위에 해당하지 않는 경기가 포함되어 있습니다."],
  ["event_competition_mismatch", "요청한 대회 범위와 다른 경기가 포함되어 있습니다."],
  ["event_source_unverified", "경기 출처를 확인할 수 없습니다."],
  ["event_timestamp_invalid", "경기 시작 시각을 확인할 수 없습니다."],
  ["event_date_mismatch", "경기 날짜가 요청한 날짜와 다릅니다."],
  ["body_inventory_missing", "일정에 포함된 경기가 분석 본문에서 누락되었습니다."],
  ["duplicate_event_key", "같은 경기가 일정에 중복되어 있습니다."],
  ["duplicate_assessment", "같은 경기가 중복 평가되었습니다."],
  ["assessment_outside_inventory", "일정에 없는 경기가 평가 대상으로 표시되었습니다."],
  ["inventory_assessments_missing", "일부 경기를 평가하지 못했습니다."],
  ["schedule_source_unverified", "일정 출처를 확인할 수 없습니다."],
  ["schedule_competition_mismatch", "일정 출처의 대회 범위가 요청과 다릅니다."],
  ["duplicate_schedule_competition", "같은 대회 일정이 중복 확인되었습니다."],
  ["schedule_count_mismatch", "일정에 표시된 경기 수와 확인한 경기 수가 다릅니다."],
  ["inventory_declared_incomplete", "일정 목록이 완전하지 않다고 보고되었습니다."],
  ["schedule_scope_not_proven", "요청한 모든 대회의 일정 범위를 확인하지 못했습니다."],
  ["zero_inventory_not_proven", "해당 날짜에 경기가 없는지 확인할 근거가 부족합니다."],
  ["independent_schedule_verification_unavailable", "일정 전체를 별도 자료로 독립 검증하지 못했습니다."],
];

const genericReason = "범위 검증을 완료하지 못한 항목이 있습니다.";
const maxHumanReasonLength = 500;

/** Converts validation codes to Korean while retaining bounded human-authored limitations. */
export function formatCoverageReason(code: string): string {
  const value = code.trim();
  if (!value) return genericReason;
  const known = reasonLabels.find(([prefix]) => value === prefix || value.startsWith(`${prefix}:`));
  if (known) return known[1];
  if (/^[a-z][a-z0-9_.-]*(?::[a-zA-Z0-9_.:/-]+)*$/.test(value) || /^[A-Z][A-Z0-9_.:-]*$/.test(value)) return genericReason;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maxHumanReasonLength);
}
