import { describe, expect, it } from "vitest";
import { formatCoverageReason } from "./coverage-labels";

describe("formatCoverageReason", () => {
  it.each([
    ["coverage_report_absent", "일정 범위를 확인할 검증 보고서가 없습니다."],
    ["competition_scope_unknown", "대회 범위를 확인하지 못했습니다."],
    ["invalid_or_ambiguous_request_date", "요청 날짜가 없거나 모호해 확인이 필요합니다."],
    ["event_source_unverified:mlb:2026-09-30:game-1", "경기 출처를 확인할 수 없습니다."],
    ["schedule_count_mismatch:MLS:5:4", "일정에 표시된 경기 수와 확인한 경기 수가 다릅니다."],
  ])("maps %s to a user-facing Korean reason", (code, label) => {
    expect(formatCoverageReason(code)).toBe(label);
    expect(formatCoverageReason(code)).not.toContain(code.split(":")[0]);
  });

  it("preserves human-readable limitations and hides unknown machine codes", () => {
    expect(formatCoverageReason("공식 일정 페이지에서 시간이 공개되지 않았습니다.")).toBe("공식 일정 페이지에서 시간이 공개되지 않았습니다.");
    expect(formatCoverageReason("future_machine_warning:detail")).toBe("범위 검증을 완료하지 못한 항목이 있습니다.");
    expect(formatCoverageReason("UPSTREAM_ERROR_429")).toBe("범위 검증을 완료하지 못한 항목이 있습니다.");
  });
});
