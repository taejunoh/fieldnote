import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYSIS_INSTRUCTIONS, assembleContext } from "./context";
import { analysisSettings, extractAnalysisOutput } from "./openai";
import type OpenAI from "openai";

afterEach(() => vi.unstubAllEnvs());

describe("gateway analysis settings", () => {
  it("uses Astra Extra High for a lineup recheck and Medium for status", () => {
    vi.stubEnv("OPENLLMS_MODEL", "gpt-6-astra");
    vi.stubEnv("OPENLLMS_EFFORT_RECHECK", "xhigh");
    vi.stubEnv("OPENLLMS_EFFORT_STATUS", "medium");
    vi.stubEnv("OPENAI_MODEL", "gpt-6-sol");
    vi.stubEnv("OPENAI_EFFORT_RECHECK", "high");
    vi.stubEnv("OPENAI_EFFORT_STATUS", "low");
    expect(analysisSettings("recheck_lineup")).toEqual({ model: "gpt-6-astra", effort: "xhigh" });
    expect(analysisSettings("check_status")).toEqual({ model: "gpt-6-astra", effort: "medium" });
  });

  it("does not inherit paid API model or effort settings", () => {
    vi.stubEnv("OPENLLMS_MODEL", "");
    vi.stubEnv("OPENLLMS_EFFORT_RECHECK", "");
    vi.stubEnv("OPENLLMS_EFFORT_STATUS", "");
    vi.stubEnv("OPENAI_MODEL", "gpt-6-sol");
    vi.stubEnv("OPENAI_EFFORT_RECHECK", "high");
    vi.stubEnv("OPENAI_EFFORT_STATUS", "low");
    expect(analysisSettings("recheck_lineup")).toEqual({ model: "gpt-6-astra", effort: "xhigh" });
    expect(analysisSettings("check_status")).toEqual({ model: "gpt-6-astra", effort: "medium" });
  });
});

describe("analysis context", () => {
  it("defines complete discovery scope and places coverage before persisted record instructions", () => {
    const context = JSON.parse(assembleContext({ sport: "nfl", now: new Date("2026-10-01T03:00:00Z"), request: "분석", current_job_kind: "analyze_today", criteria: [], events: [{ label: "old candidate" }], messages: [], recommendations: [], bets: [], mistakes: [], summaries: [] }));
    expect(context).toMatchObject({ analysis_scope: { date_et: "2026-09-30", competitions: ["NFL"] }, current_job_kind: "analyze_today" });
    expect(context.active_events_explanation).toContain("not a complete schedule");
    expect(ANALYSIS_INSTRUCTIONS).toContain("analysis-coverage");
    expect(ANALYSIS_INSTRUCTIONS).toContain("전체 일정");
    expect(ANALYSIS_INSTRUCTIONS).toContain("최대 500");
  });

  it("requires verified ET start times in match-by-match analysis tables", () => {
    expect(ANALYSIS_INSTRUCTIONS).toContain("시작 시각 (ET)");
    expect(ANALYSIS_INSTRUCTIONS).toContain("미확인");
    expect(ANALYSIS_INSTRUCTIONS).toContain("America/New_York");
    expect(ANALYSIS_INSTRUCTIONS).toContain("해당 타임스탬프를 America/New_York로 변환해 표시한다");
    expect(ANALYSIS_INSTRUCTIONS).toContain("날짜만으로 시작 시각을 추정하지 않는다");
    expect(ANALYSIS_INSTRUCTIONS).toContain("전반 요약표나 사후 결과표에는 적용하지 않는다");
  });

  it("includes adopted rules and marks imported facts as historical", () => {
    const content = assembleContext({
      sport: "mlb",
      now: new Date("2026-09-23T15:00:00Z"),
      request: "라인업 재확인",
      criteria: [
        { id: "current", content: "새 규칙", status: "adopted" },
        {
          id: "old",
          content: "옛 규칙",
          status: "superseded",
          source_document_id: "doc",
        },
      ],
      events: [{ id: "game", label: "A vs B", source_document_id: "doc" }],
      messages: [{ id: "correction", role: "user", content: "사용자 정정" }],
      recommendations: [],
      bets: [],
      mistakes: [],
      summaries: [{ content: "오래된 요약", source_message_ids: ["m1"] }],
    });
    expect(content).toContain("새 규칙");
    expect(content).not.toContain("옛 규칙");
    expect(content).toContain(
      "imported historical document; not currently web verified",
    );
    expect(content).toContain("사용자 정정");
    expect(content).toContain("source_message_ids");
  });
});

describe("response extraction", () => {
  it("retains links and check time after a verified search call", () => {
    const response = {
      id: "resp_test",
      status: "completed",
      output_text: "최신 분석",
      output: [
        {
          type: "web_search_call",
          status: "completed",
          action: {
            sources: [{ title: "Official", url: "https://example.com/game" }],
          },
        },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "최신 분석",
              annotations: [
                {
                  type: "url_citation",
                  title: "Official",
                  url: "https://example.com/game",
                },
              ],
            },
          ],
        },
      ],
    } as unknown as OpenAI.Responses.Response;
    const output = extractAnalysisOutput(
      response,
      new Date("2026-09-23T15:00:00Z"),
    );
    expect(output.metadata.sources).toEqual([
      { title: "Official", url: "https://example.com/game" },
    ]);
    expect(output.metadata.searched).toBe(true);
    expect(output.content).toContain("https://example.com/game");
    expect(output.content).toContain("자료 확인 시각");
  });

  it("does not present unsearched model text as a valid latest analysis", () => {
    const response = {
      id: "resp_test",
      status: "completed",
      output_text: "확실한 픽",
      output: [],
    } as unknown as OpenAI.Responses.Response;
    const output = extractAnalysisOutput(response);
    expect(output.content).not.toContain("확실한 픽");
    expect(output.metadata.unknowns).not.toHaveLength(0);
  });
});
