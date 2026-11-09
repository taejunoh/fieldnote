import type { EvaluationPresentationDisplay } from "@/lib/analysis/evaluation-recovery";
import type { EvaluationDisplay, EvaluationMarket } from "@/lib/analysis/evaluation";

const stateLabels = {
  valuation_complete: "평가 완료",
  information_wait: "정보 대기",
  research_incomplete: "조사 미완료",
  not_evaluated: "미평가",
} as const;

const categoryLabels: Record<string, string> = {
  participants: "주요 선수·출전 정보",
  matchup: "상대 전력 정보",
  workload: "휴식·출전 부담",
  dependencies: "종목별 핵심 조건",
};

function reasonLabel(reason: string): string {
  const match = reason.match(/^([^:]+):(\d+)(?::([^:]+))?/);
  if (!match) return "추가 확인 필요";
  const [, code, , category] = match;
  const categoryLabel = category ? categoryLabels[category] || "핵심 정보" : "시장 평가";
  if (code === "critical_check_missing") return `${categoryLabel} 점검 누락`;
  if (code === "critical_evidence_missing") return `${categoryLabel} 근거·출처 확인 필요`;
  if (code === "critical_missing") return `${categoryLabel} 확인 정보 없음`;
  if (code === "critical_conflicting") return `${categoryLabel} 정보가 서로 다름`;
  if (code === "valuation_price_missing") return "완료 보고에 관측 가격이 없음";
  if (["wait_state_conflict", "pass_state_conflict", "wait_trigger_missing"].includes(code)) return "원래 판단과 평가 상태 또는 재평가 조건 확인 필요";
  if (code.startsWith("canonical_")) return "저장된 판단·가격 조건과 보고 내용이 다름";
  if (code === "countercase_missing") return "반대 근거가 비어 있음";
  return "추가 확인 필요";
}

function rowWarnings(evaluation: EvaluationDisplay, index: number, row: EvaluationMarket) {
  const originalIndex = evaluation.validation.acceptedMarketIndexes?.[index] ?? index;
  const reasons = evaluation.validation.reasons.filter(reason => reason.match(/^[^:]+:(\d+)/)?.[1] === String(originalIndex));
  const labels = reasons.map(reasonLabel);
  if (row.countercase.trim().length === 0) labels.push("반대 근거가 비어 있음");
  if (row.critical_checks.some(check => check.status === "missing" || check.status === "conflicting")) {
    for (const check of row.critical_checks.filter(item => item.status === "missing" || item.status === "conflicting")) {
      if (reasons.some(reason => reason.startsWith(`critical_${check.status}:${originalIndex}:${check.category}`))) continue;
      labels.push(`${categoryLabels[check.category]} ${check.status === "missing" ? "확인 정보 없음" : "정보가 서로 다름"}`);
    }
  }
  if (row.state === "valuation_complete" && !row.observed_price) labels.push("완료 보고에 관측 가격이 없음");
  if (row.state === "information_wait" && !row.uncertainty.reopen_trigger.trim()) labels.push("정보 대기 재평가 조건이 없음");
  return [...new Set(labels)];
}

function safeSource(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !/[\s<>]/.test(value)
      ? url.href
      : null;
  } catch { return null; }
}

export function MarketEvaluation({ evaluation, presentation, savedBodyExists = false }: { evaluation: EvaluationDisplay | null; presentation?: EvaluationPresentationDisplay | null; savedBodyExists?: boolean }) {
  const historical = presentation?.context === "historical";
  const contextNotice = historical ? <p>저장된 과거·가정 분석입니다. 현재 추천을 만들지 않습니다. {presentation.reason}</p> : null;
  if (!evaluation) return savedBodyExists || historical ? <aside className="market-evaluation market-evaluation-unavailable">{contextNotice}<p>저장된 분석 본문은 있지만 구조화된 시장 평가 블록이 없습니다.</p></aside> : null;
  const { report, validation } = evaluation;
  const quarantine = evaluation.quarantinedMarkets?.length ? <div className="market-evaluation-quarantine"><p>일부 시장은 출처·형식 확인이 필요하여 제외 · 검증된 추천이 아닙니다.</p><ul>{evaluation.quarantinedMarkets.map(row => <li key={row.originalIndex}>{row.label} · {row.market}: {row.selection} · 원래 판단: {row.originalDecision ?? "미기재"} · {row.reasons.some(reason => /source|url/.test(reason)) ? "출처 확인 필요" : "형식 확인 필요"}</li>)}</ul></div> : null;
  if (!report || !["valid", "partial"].includes(validation.status)) {
    return <aside className="market-evaluation market-evaluation-unavailable">{contextNotice}<p>시장 평가 정보 확인 불가 · 저장된 분석 본문은 별도로 확인할 수 있습니다.</p><p>{validation.reasons.includes("evaluation_report_absent") ? "구조화된 시장 평가 블록이 없습니다." : "시장 평가 형식 또는 출처 확인이 필요합니다."}</p>{validation.details?.length ? <ul>{validation.details.map((detail, index) => <li key={index}>{detail.path}: {detail.code} · {detail.message}</li>)}</ul> : null}{quarantine}</aside>;
  }
  const counts = validation.counts;
  const warnings = report.markets.map((row, index) => rowWarnings(evaluation, index, row));
  const challengedComplete = report.markets.filter((row, index) => row.state === "valuation_complete" && warnings[index].length > 0).length;
  const needsAttention = warnings.filter(row => row.length > 0).length;
  return (
    <details className="market-evaluation">
      <summary>선택 시장 자체 보고 · 완료 보고 {counts.valuation_complete} · 확인 필요 {needsAttention}{challengedComplete ? ` (완료 보고 중 ${challengedComplete}건)` : ""} · 정보 대기 {counts.information_wait} · 조사 미완료 {counts.research_incomplete} · 미평가 {counts.not_evaluated}</summary>
      {contextNotice}
      {quarantine}
      <div className="market-evaluation-note">선택한 {report.markets.length}개 시장만 포함 · 모델 자체 보고이며 독립 검증된 사실이 아닙니다{report.truncated ? " · 보고 범위 일부 생략" : ""}</div>
      {report.scope_note && <p className="market-evaluation-scope">{report.scope_note}</p>}
      <ol className="market-evaluation-list">
        {report.markets.map((row, index) => (
          <li key={`${row.event_key}-${row.market}-${row.selection}-${index}`}>
            <div className="market-evaluation-title"><b>{row.label}</b><span>{row.market}: {row.selection}{row.line ? ` (${row.line})` : ""}</span><small>원래 판단: {row.original_decision}</small><em>{row.state === "valuation_complete" && warnings[index].length ? "완료 보고 · 보완 필요" : stateLabels[row.state]}</em></div>
            <div className="market-evaluation-prices">
              <span>관측 가격: {row.observed_price?.value ?? "없음"}</span>
              <span>가격 조건: {row.price_condition ?? "없음"}</span>
              {row.observed_price && safeSource(row.observed_price.source_url) && <a href={safeSource(row.observed_price.source_url)!} target="_blank" rel="noopener noreferrer">가격 출처</a>}
            </div>
            <p>{row.thesis}</p>
            <details className="market-evaluation-more">
              <summary>반대 근거와 확인 사항</summary>
              <p><b>반대 근거:</b> {row.countercase}</p>
              {row.critical_checks.filter(check => check.status === "missing" || check.status === "conflicting").map((check, checkIndex) => <p key={`${check.category}-${checkIndex}`}><b>{check.status === "missing" ? "확인되지 않음" : "정보 충돌"} · {check.category}:</b> {check.evidence}</p>)}
              <p><b>불확실성:</b> {row.uncertainty.impact} · {row.uncertainty.scenario}</p>
              <p><b>재평가 조건:</b> {row.uncertainty.reopen_trigger}</p>
              {warnings[index].length > 0 && <ul className="market-evaluation-warnings">{warnings[index].map((warning, warningIndex) => <li key={`${warning}-${warningIndex}`}>{warning}</li>)}</ul>}
              {row.critical_checks.flatMap(check => check.source_urls).map(safeSource).filter((url): url is string => !!url).map((url, linkIndex) => <a className="market-evaluation-source" key={`${url}-${linkIndex}`} href={url} target="_blank" rel="noopener noreferrer">확인 출처 {linkIndex + 1}</a>)}
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}
