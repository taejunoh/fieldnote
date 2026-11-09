import type OpenAI from "openai";

export type AnalysisKind =
  | "analyze_today"
  | "recheck_lineup"
  | "review_results"
  | "check_status"
  | "message";

export function analysisSettings(kind: AnalysisKind) {
  const isStatus = kind === "check_status";
  const effort = isStatus
    ? process.env.OPENLLMS_EFFORT_STATUS || "medium"
    : kind === "recheck_lineup"
      ? process.env.OPENLLMS_EFFORT_RECHECK || "high"
      : process.env.OPENLLMS_EFFORT_ANALYSIS || "high";
  if (isStatus ? effort !== "medium" : effort !== "high" && effort !== "xhigh")
    throw new Error(`Unsupported OPENLLMS effort for ${kind}: ${effort}`);
  const model = process.env.OPENLLMS_MODEL || "gpt-6-astra";
  if (model !== "gpt-6-astra")
    throw new Error(`Unsupported OPENLLMS model: ${model}`);
  return {
    model,
    effort: effort as "medium" | "high" | "xhigh",
  };
}

export interface AnalysisOutput {
  content: string;
  metadata: {
    checked_at: string;
    sources: { title: string; url: string }[];
    searched: boolean;
    unknowns: string[];
    response_id: string;
    recommendations_persisted: false;
  };
}

export function extractAnalysisOutput(
  response: OpenAI.Responses.Response,
  checkedAt = new Date(),
): AnalysisOutput {
  const sources = new Map<string, { title: string; url: string }>();
  const output = response.output as unknown as Array<Record<string, unknown>>;
  const searched = output.some(
    (item) => item.type === "web_search_call" && item.status === "completed",
  );
  for (const item of output) {
    if (item.type === "web_search_call") {
      const action = item.action as Record<string, unknown> | undefined;
      if (Array.isArray(action?.sources))
        for (const source of action.sources as Array<Record<string, unknown>>) {
          if (typeof source.url !== "string") continue;
          try {
            const url = new URL(source.url);
            if (url.protocol === "https:" || url.protocol === "http:")
              sources.set(url.href, {
                title: String(source.title || url.hostname),
                url: url.href,
              });
          } catch {
            /* Ignore malformed source URLs. */
          }
        }
    }
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content as Array<Record<string, unknown>>) {
      if (!Array.isArray(part.annotations)) continue;
      for (const annotation of part.annotations as Array<
        Record<string, unknown>
      >) {
        if (
          annotation.type !== "url_citation" ||
          typeof annotation.url !== "string"
        )
          continue;
        try {
          const url = new URL(annotation.url);
          if (url.protocol === "https:" || url.protocol === "http:")
            sources.set(url.href, {
              title: String(annotation.title || url.hostname),
              url: url.href,
            });
        } catch {
          /* Ignore malformed citation URLs. */
        }
      }
    }
  }
  const checked = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(checkedAt);
  const cited = [...sources.values()];
  const original =
    response.output_text?.trim() || "분석 응답에 표시할 텍스트가 없습니다.";
  const unknowns = !searched
    ? ["웹 검색 실행을 확인하지 못해 최신 경기 사실을 검증할 수 없습니다."]
    : cited.length === 0
      ? ["웹 검색은 실행됐지만 인용 가능한 출처 링크를 확인하지 못했습니다."]
      : [];
  const content = unknowns.length
    ? `최신 자료 확인이 완료되지 않았습니다. 이번 응답을 분석 결과로 사용하지 마세요.\n\n미확인 사항: ${unknowns.join(" ")}\n\n확인 시각: ${checked} (America/New_York)`
    : `${original}\n\n---\n자료 확인 시각: ${checked} (America/New_York)\n출처: ${cited.map((source) => `[${source.title}](${source.url})`).join(" · ")}\n미확인 사항: 본문에 명시한 사항 참조.`;
  return {
    content,
    metadata: {
      checked_at: checkedAt.toISOString(),
      sources: cited,
      searched,
      unknowns,
      response_id: response.id,
      recommendations_persisted: false,
    },
  };
}
