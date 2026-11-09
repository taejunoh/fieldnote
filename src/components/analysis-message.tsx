import type { EvaluationPresentationDisplay } from "@/lib/analysis/evaluation-recovery";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RecordRecoveryDTO } from "../lib/record-recovery";
import { RecordRecoveryStatus } from "./record-recovery-status";
import { splitMessageSources } from "../lib/message-sources";
import { MarketEvaluation } from "./market-evaluation";
import type { EvaluationDisplay } from "@/lib/analysis/evaluation";

type RepairCitationSupplement = {
  event_key: string;
  label: string;
  source_url: string;
};

function isRepairCitationSupplement(value: unknown): value is RepairCitationSupplement {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.event_key !== "string" || !record.event_key.trim() || record.event_key.length > 2000 ||
    typeof record.label !== "string" || !record.label.trim() || record.label.length > 2000 ||
    typeof record.source_url !== "string" || record.source_url.length > 2048 ||
    record.reason !== "original_inventory_citation"
  ) return false;
  if (!/^https:\/\//i.test(record.source_url)) return false;

  try {
    const url = new URL(record.source_url);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && !url.port &&
      !/[\s<>]/.test(record.source_url);
  } catch {
    return false;
  }
}

function RepairCitationSupplements({ value }: { value: unknown }) {
  if (!Array.isArray(value)) return null;
  const supplements = value.filter(isRepairCitationSupplement).slice(0, 500);
  if (supplements.length === 0) return null;

  return (
    <footer className="analysis-source-footer">
      <div className="analysis-source-meta">기록 복구 출처 보완</div>
      <div className="analysis-source-meta">원래 경기 목록에 연결된 출처를 복구 과정에서 보완했습니다.</div>
      <ul className="analysis-source-list">
        {supplements.map((source, index) => (
          <li key={`${source.event_key}-${index}`}>
            <a href={source.source_url} target="_blank" rel="noopener noreferrer">
              {source.label}
            </a>
          </li>
        ))}
      </ul>
    </footer>
  );
}

const markdownComponents: Components = {
  a: ({ href, children, ...props }) => (
    <a {...props} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children, ...props }) => (
    <div className="markdown-table-scroll">
      <table {...props}>{children}</table>
    </div>
  ),
};

export function AnalysisMessage({ content, type = "analysis", repairCitationSupplements, recovery, evaluation, evaluationPresentation }: {
  content: string;
  type?: "analysis" | "conversation";
  repairCitationSupplements?: unknown;
  recovery?: RecordRecoveryDTO | null;
  evaluation?: EvaluationDisplay | null;
  evaluationPresentation?: EvaluationPresentationDisplay | null;
}) {
  const parsed = splitMessageSources(content, type);

  if (!parsed) {
    return (
      <>
        {type === "analysis" ? <MarketEvaluation evaluation={evaluation ?? null} presentation={evaluationPresentation} savedBodyExists={!!content.trim()} /> : null}
        {recovery?.status === "partial" ? <RecordRecoveryStatus recovery={recovery} /> : null}
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {content}
        </ReactMarkdown>
        <RepairCitationSupplements value={repairCitationSupplements} />
      </>
    );
  }

  return (
    <>
      {type === "analysis" ? <MarketEvaluation evaluation={evaluation ?? null} presentation={evaluationPresentation} savedBodyExists={!!content.trim()} /> : null}
      {recovery?.status === "partial" ? <RecordRecoveryStatus recovery={recovery} /> : null}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {parsed.body}
      </ReactMarkdown>
      <footer className="analysis-source-footer">
        <details className="analysis-source-disclosure">
          <summary>출처 {parsed.sources.length}개 보기</summary>
          <ul className="analysis-source-list">
            {parsed.sources.map((source, index) => (
              <li key={`${source.url}-${index}`}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
        <div className="analysis-source-meta">
          자료 확인 시각: {parsed.checkedAt} (America/New_York)
        </div>
        <div className="analysis-source-meta">미확인 사항: {parsed.unknowns}</div>
      </footer>
      <RepairCitationSupplements value={repairCitationSupplements} />
    </>
  );
}
