import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sourcedEventKey } from "./record";
import { GatewayError, runGatewayAnalysis, type GatewayResult } from "./gateway";
import { buildSummaryCandidate, classifyGatewayFailure, createSupabaseWorkerStore, runOnce, type ClaimedJob, type WorkerStore } from "./worker";

const job: ClaimedJob = {
  id: "job-1", owner_id: "owner-1", sport_id: "sport-1", user_message_id: "message-1",
  kind: "analyze_today", model: "gpt-6-astra", effort: "xhigh", current_attempt_id: "attempt-1",
};
const verified: GatewayResult = {
  text: "분석 내용", sources: [{ title: "League", url: "https://example.com/game" }],
  searched: true, verified: true, upstreamResponseId: "upstream-1", usage: { inputTokens: 400, outputTokens: 100 },
};

function store(): WorkerStore {
  return {
    claim: vi.fn().mockResolvedValue(job),
    heartbeat: vi.fn().mockResolvedValue(true),
    context: vi.fn().mockResolvedValue("stored context"),
    saveInputSnapshot: vi.fn().mockResolvedValue(true),
    loadCompletion: vi.fn().mockResolvedValue(null),
    saveCompletion: vi.fn().mockResolvedValue(true),
    finalize: vi.fn().mockResolvedValue("assistant-1"),
    finalizeConversation: vi.fn().mockResolvedValue("assistant-1"),
    fail: vi.fn().mockResolvedValue(true),
    summarize: vi.fn().mockResolvedValue(undefined),
  };
}

describe("persistent analysis worker", () => {
  afterEach(() => vi.useRealTimers());

  it("durably stores exact gateway input before execution and retains raw response with separate requested/reported settings", async () => {
    const db = store(); const gateway = vi.fn(async () => {
      expect(db.saveInputSnapshot).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", expect.objectContaining({ context: "stored context", instructions: expect.any(String), requested: { model: "gpt-6-astra", effort: "xhigh", mode: "default_standard" }, context_sha256: createHash("sha256").update("stored context").digest("hex") }));
      return verified;
    });
    await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(gateway).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.finalize).mock.calls[0][4]).toMatchObject({ original_model_response: verified.text, coverage: { status: "unverified" }, requested: { model: "gpt-6-astra", effort: "xhigh", mode: "default_standard" }, upstream_reported: { model: null, reasoning_mode: null, reasoning_effort: null }, input_snapshot: { attempt_id: "attempt-1", context_sha256: expect.any(String) } });
  });
  it.each([false, "error"])("does not execute gateway if snapshot persistence fails (%s)", async failure => {
    const db = store(); db.saveInputSnapshot = failure === false ? vi.fn().mockResolvedValue(false) : vi.fn().mockRejectedValue(new Error("offline"));
    const gateway = vi.fn();
    const result = await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(gateway).not.toHaveBeenCalled(); expect(db.finalize).not.toHaveBeenCalled();
    expect(result.status).toBe(failure === false ? "lease_lost" : "failed");
  });
  it("does not execute gateway after context loading fails", async () => {
    const db = store(); db.context = vi.fn().mockRejectedValue(new Error("missing document")); const gateway = vi.fn();
    expect((await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" })).status).toBe("failed");
    expect(gateway).not.toHaveBeenCalled(); expect(db.saveInputSnapshot).not.toHaveBeenCalled();
  });

  it("formats coverage warning reasons in Korean while preserving raw audit codes", async () => {
    const db = store();
    await runOnce({ store: db, gateway: vi.fn().mockResolvedValue(verified), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    const call = vi.mocked(db.finalize).mock.calls[0];
    expect(call[3]).toContain("일정 범위를 확인할 검증 보고서가 없습니다.");
    expect(call[3]).not.toContain("coverage_report_absent");
    expect(call[4]).toMatchObject({ coverage: { reasons: expect.arrayContaining(["coverage_report_absent"]) } });
  });

  it("strips only coverage before record extraction while preserving both raw envelopes and genuine upstream settings", async () => {
    const db = store();
    const scope = { version: 1, sport: "mlb", date_et: "2026-09-30", timezone: "America/New_York", mode: "daily", competitions: ["MLB"], basis: "default" };
    db.context = vi.fn().mockResolvedValue(JSON.stringify({ sport: "mlb", analysis_scope: scope }));
    const report = { version: 1, scope, inventory: [], assessments: [], schedule_sources: [{ url: verified.sources[0].url, competition: "MLB", expected_count: 0 }], inventory_complete: true, limitations: [] };
    const response = `No games\n\n\`\`\`typescript\nconst example = 1;\n\`\`\`\n\`\`\`analysis-coverage\n${JSON.stringify(report)}\n\`\`\`\n\`\`\`analysis-record\n${JSON.stringify({ version: 1, sport: "mlb", events: [], recommendations: [] })}\n\`\`\``;
    await runOnce({ store: db, gateway: vi.fn().mockResolvedValue({ ...verified, text: response, upstreamReportedModel: "reported-model", upstreamReportedReasoningMode: "reported-mode", upstreamReportedReasoningEffort: "reported-effort" }), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    const call = vi.mocked(db.finalize).mock.calls[0];
    expect(call[3]).not.toContain("analysis-coverage"); expect(call[3]).not.toContain("analysis-record"); expect(call[3]).toContain("const example = 1;");
    expect(call[4]).toMatchObject({ original_model_response: response, coverage_report: report, coverage: { status: "unverified" }, extraction_status: "complete", upstream_reported: { model: "reported-model", reasoning_mode: "reported-mode", reasoning_effort: "reported-effort" } });
  });

  it("preserves a completed analysis after a transient heartbeat error and recovery", async () => {
    vi.useFakeTimers();
    const db = store();
    db.heartbeat = vi.fn().mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("database restarting"))
      .mockResolvedValue(true);
    const gateway = vi.fn(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      return verified;
    });
    const result = await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(result.status).toBe("completed");
    expect(gateway).toHaveBeenCalledTimes(1);
    expect(db.finalize).toHaveBeenCalledTimes(1);
  });

  it("never finalizes after a heartbeat definitively reports lost ownership", async () => {
    vi.useFakeTimers();
    const db = store();
    db.heartbeat = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(true);
    const gateway = vi.fn(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      return verified;
    });
    const result = await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(result.status).toBe("lease_lost");
    expect(db.finalize).not.toHaveBeenCalled();
    expect(db.fail).not.toHaveBeenCalled();
  });

  it("rechecks ownership before saving even when the response arrives before the first periodic heartbeat", async () => {
    const db = store();
    db.heartbeat = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await runOnce({ store: db, gateway: vi.fn().mockResolvedValue(verified), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(result.status).toBe("lease_lost");
    expect(db.finalize).not.toHaveBeenCalled();
  });

  it("retries a transient final ownership outage without regenerating the completed answer", async () => {
    const db = store();
    db.heartbeat = vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValue(true);
    const gateway = vi.fn().mockResolvedValue(verified);
    expect(await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" })).toMatchObject({ status: "completed" });
    expect(db.saveCompletion).toHaveBeenCalledOnce();
    expect(db.finalize).toHaveBeenCalledOnce();
    expect(gateway).toHaveBeenCalledOnce();
    expect(db.fail).not.toHaveBeenCalled();
  });

  it.each(["insufficient_quota", "usage_limit_reached", "token_expired", "invalid_api_key"])("classifies safe nested terminal failure %s", code => {
    expect(classifyGatewayFailure(new GatewayError("upstream_failed", "terminal failure", undefined, { terminalStatus: "failed", upstreamErrorCode: code })).status)
      .toBe(["insufficient_quota", "usage_limit_reached"].includes(code) ? "waiting_quota" : "relogin_required");
  });

  it("checkpoints exact completed evidence before parsing or publishing", async () => {
    const db = store();
    db.finalize = vi.fn(async () => {
      expect(db.saveCompletion).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", { version: 1, result: verified, checked_at: "2026-10-27T12:00:00.000Z" });
      return "assistant-1";
    });
    await runOnce({ store: db, gateway: vi.fn().mockResolvedValue(verified), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra", now: () => new Date("2026-10-27T12:00:00Z") });
  });

  it("resumes an immutable completion after failed publication without loading new context or calling the model", async () => {
    const db = store();
    db.finalize = vi.fn().mockRejectedValue(new Error("storage offline"));
    const first = await runOnce({ store: db, gateway: vi.fn().mockResolvedValue(verified), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra", now: () => new Date("2026-10-27T12:00:00Z") });
    expect(first.status).toBe("interrupted");
    expect(db.finalize).toHaveBeenCalledTimes(3);
    expect(db.fail).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", "interrupted", expect.stringContaining("모델을 다시 호출하지 않고"), expect.objectContaining({ code: "completion_finalize_failed", completion_saved: true }));
    const original = vi.mocked(db.saveCompletion).mock.calls[0][3];
    const snapshot = vi.mocked(db.saveInputSnapshot).mock.calls[0][3];
    const retry = store();
    retry.claim = vi.fn().mockResolvedValue({ ...job, current_attempt_id: "attempt-2" });
    retry.loadCompletion = vi.fn().mockResolvedValue({ ...original, original_attempt_id: "attempt-1", input_snapshot: snapshot });
    const gateway = vi.fn();
    const restored = await runOnce({ store: retry, gateway, workerId: "worker-2", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra", now: () => new Date("2026-10-28T12:00:00Z") });
    expect(restored.status).toBe("completed");
    expect(gateway).not.toHaveBeenCalled();
    expect(retry.context).not.toHaveBeenCalled();
    expect(retry.saveCompletion).not.toHaveBeenCalled();
    expect(retry.finalize).toHaveBeenCalledOnce();
    expect(vi.mocked(retry.finalize).mock.calls[0][3]).toBe(vi.mocked(db.finalize).mock.calls[0][3]);
    expect(vi.mocked(retry.finalize).mock.calls[0][4]).toMatchObject({ original_model_response: verified.text, sources: verified.sources, checked_at: original.checked_at, input_snapshot: { attempt_id: "attempt-1" }, completion_recovery: { original_attempt_id: "attempt-1", original_checked_at: original.checked_at, recovered_at: "2026-10-28T12:00:00.000Z" } });
    expect(vi.mocked(retry.saveInputSnapshot).mock.calls[0][3]).toMatchObject({ context: snapshot.context, instructions: snapshot.instructions });
  });

  it("retries an ambiguous finalize acknowledgment with the identical payload, never another generation", async () => {
    const db = store();
    db.finalize = vi.fn().mockRejectedValueOnce(new Error("committed but connection reset")).mockResolvedValue("assistant-1");
    const gateway = vi.fn().mockResolvedValue(verified);
    expect((await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" })).status).toBe("completed");
    expect(gateway).toHaveBeenCalledOnce();
    expect(vi.mocked(db.finalize).mock.calls[0]).toEqual(vi.mocked(db.finalize).mock.calls[1]);
  });

  it("fails closed before model execution when the completion migration is absent", async () => {
    const db = store();
    db.loadCompletion = vi.fn().mockRejectedValue({ code: "PGRST202" });
    const gateway = vi.fn();
    expect((await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" })).status).toBe("failed");
    expect(db.loadCompletion).toHaveBeenCalledOnce();
    expect(gateway).not.toHaveBeenCalled();
    expect(db.fail).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", "failed", expect.stringContaining("migration"), expect.objectContaining({ code: "completion_load_failed", execution_started: false }));
  });

  it("does not publish or retry a generation when the durable checkpoint cannot be saved", async () => {
    const db = store();
    db.saveCompletion = vi.fn().mockRejectedValue(new Error("offline"));
    const gateway = vi.fn().mockResolvedValue(verified);
    expect((await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" })).status).toBe("interrupted");
    expect(db.saveCompletion).toHaveBeenCalledTimes(3);
    expect(db.finalize).not.toHaveBeenCalled();
    expect(gateway).toHaveBeenCalledOnce();
    expect(db.fail).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", "interrupted", expect.any(String), expect.objectContaining({ code: "completion_checkpoint_failed", completion_saved: false }));
  });

  it("marks execution immediately before gateway call and finalizes verified sources once", async () => {
    const db = store();
    const gateway = vi.fn().mockResolvedValue(verified);
    const result = await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra", now: () => new Date("2026-09-23T15:00:00Z") });
    expect(result).toEqual({ status: "completed", jobId: "job-1" });
    expect(db.heartbeat).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", true);
    expect(gateway).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-6-astra", effort: "xhigh", context: "stored context" }));
    expect(db.finalize).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", expect.stringContaining("분석 내용"), expect.objectContaining({ searched: true, verified: true, sources: verified.sources }), "upstream-1");
    expect(db.fail).not.toHaveBeenCalled();
    expect(db.summarize).toHaveBeenCalledWith(job);
  });

  it("persists completed WebSocket terminal audit metadata with a verified analysis", async () => {
    const db = store();
    const gateway = vi.fn().mockResolvedValue({
      ...verified,
      upstreamReportedModel: "gpt-6-astra",
      upstreamReportedReasoningEffort: "xhigh",
      safeDiagnostics: { terminalStatus: "completed", upstreamResponseId: "resp-ws", upstreamTransport: "ws", lastEventType: "response.completed" },
    });
    await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(db.finalize).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", expect.any(String), expect.objectContaining({
      terminalStatus: "completed",
      requested: { model: "gpt-6-astra", effort: "xhigh", mode: "default_standard" },
      upstream_reported: { model: "gpt-6-astra", reasoning_mode: null, reasoning_effort: "xhigh" },
      searched: true, verified: true,
      llms: { terminal: { status: "completed", upstream_response_id: "resp-ws", upstream_transport: "ws", last_event_type: "response.completed" } },
    }), "upstream-1");
  });

  it("drops an unknown transport enum from completed terminal audit metadata", async () => {
    const db = store();
    const gateway = vi.fn().mockResolvedValue({
      ...verified,
      safeDiagnostics: { terminalStatus: "completed", upstreamTransport: "ws-private-detail" } as never,
    });
    await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    const metadata = vi.mocked(db.finalize).mock.calls[0][4];
    expect(metadata).toMatchObject({ llms: { terminal: { status: "completed" } } });
    expect(metadata).not.toHaveProperty("llms.terminal.upstream_transport");
    expect(JSON.stringify(metadata)).not.toContain("ws-private-detail");
  });

  it("passes the shared upstream timeout plus a one-minute response margin to transport", async () => {
    const db = store();
    let gatewayOptions: Record<string, unknown> = {};
    const gateway = vi.fn(async (options) => { gatewayOptions = options; return verified; });
    await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(gatewayOptions.timeoutMs).toBe(46 * 60 * 1000);
  });

  it("rejects an out-of-range timeout before claiming work", async () => {
    const db = store();
    await expect(runOnce({ store: db, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra", upstreamTimeoutSeconds: 3601 })).rejects.toThrow("OPENLLMS_UPSTREAM_TIMEOUT_SECONDS");
    expect(db.claim).not.toHaveBeenCalled();
  });

  it("records safe interruption diagnostics and response ID without finalizing partial output", async () => {
    const db = store();
    const error = new GatewayError("upstream_interrupted", "Upstream interrupted", undefined, {
      terminalStatus: "interrupted",
      upstreamErrorCode: "upstream_timeout",
      upstreamResponseId: "resp-partial",
      transportErrorKind: "connection_reset",
      requestContextCancelled: true,
      upstreamElapsedMs: 900_001,
      lastEventAgeMs: 7,
      eventCount: 14,
      upstreamHttpProtocol: "HTTP/2.0",
      requestId: "req_A1-b2",
      upstreamTransport: "ws",
      websocketCloseCode: 1011,
      websocketMessageTooBig: true,
      websocketProtocolError: true,
      lastEventType: "response.output_text.delta",
      rawBody: "private data",
    } as never);
    const result = await runOnce({ store: db, gateway: vi.fn().mockRejectedValue(error), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(result.status).toBe("interrupted");
    expect(db.finalize).not.toHaveBeenCalled();
    expect(db.finalizeConversation).not.toHaveBeenCalled();
    expect(db.fail).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", "interrupted", "설정된 분석 대기시간을 초과해 실행이 중단되었습니다. 부분 응답은 저장하지 않았습니다. 상태를 확인한 뒤 직접 재시도해 주세요.", expect.objectContaining({
      llms: { terminal: {
        status: "interrupted", error: { code: "upstream_timeout" }, upstream_response_id: "resp-partial",
        transport_error_kind: "connection_reset", request_context_cancelled: true, upstream_elapsed_ms: 900_001,
        last_event_age_ms: 7, event_count: 14, upstream_http_protocol: "HTTP/2.0", request_id: "req_A1-b2", upstream_transport: "ws",
        websocket_close_code: 1011, websocket_message_too_big: true, websocket_protocol_error: true, last_event_type: "response.output_text.delta",
      } },
    }));
    const metadata = vi.mocked(db.fail).mock.calls[0][5];
    expect(JSON.stringify(metadata)).not.toContain("private data");
  });

  it("drops unsafe or out-of-bounds diagnostics before storing the terminal audit", async () => {
    const db = store();
    const error = new GatewayError("upstream_interrupted", "Upstream interrupted", undefined, {
      terminalStatus: "interrupted", upstreamErrorCode: "upstream_transport_error", upstreamResponseId: "resp-safe",
      transportErrorKind: "credential_dump", requestContextCancelled: "yes", upstreamElapsedMs: -1,
      lastEventAgeMs: 86_400_001, eventCount: 1_000_001, upstreamHttpProtocol: "HTTP/3", requestId: "réq-private",
      upstreamTransport: "ws-private-detail",
      websocketCloseCode: 10000, websocketMessageTooBig: "true", websocketProtocolError: "true", lastEventType: "private upstream payload",
      rawContext: "private request context",
    } as never);
    await runOnce({ store: db, gateway: vi.fn().mockRejectedValue(error), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    const metadata = vi.mocked(db.fail).mock.calls[0][5];
    expect(metadata).toMatchObject({ llms: { terminal: { status: "interrupted", error: { code: "upstream_transport_error" }, upstream_response_id: "resp-safe" } } });
    expect(metadata).not.toHaveProperty("llms.terminal.transport_error_kind");
    expect(metadata).not.toHaveProperty("llms.terminal.request_context_cancelled");
    expect(metadata).not.toHaveProperty("llms.terminal.upstream_elapsed_ms");
    expect(metadata).not.toHaveProperty("llms.terminal.last_event_age_ms");
    expect(metadata).not.toHaveProperty("llms.terminal.event_count");
    expect(metadata).not.toHaveProperty("llms.terminal.upstream_http_protocol");
    expect(metadata).not.toHaveProperty("llms.terminal.request_id");
    expect(metadata).not.toHaveProperty("llms.terminal.upstream_transport");
    expect(metadata).not.toHaveProperty("llms.terminal.websocket_close_code");
    expect(metadata).not.toHaveProperty("llms.terminal.websocket_message_too_big");
    expect(metadata).not.toHaveProperty("llms.terminal.websocket_protocol_error");
    expect(metadata).not.toHaveProperty("llms.terminal.last_event_type");
    expect(JSON.stringify(metadata)).not.toContain("private request context");
  });

  it("persists HTTP and WebSocket transport values from the strict allowlist", async () => {
    for (const upstreamTransport of ["http", "ws"] as const) {
      const db = store();
      const error = new GatewayError("upstream_interrupted", "Upstream interrupted", undefined, {
        terminalStatus: "interrupted", upstreamErrorCode: "upstream_transport_error", upstreamTransport,
      });
      await runOnce({ store: db, gateway: vi.fn().mockRejectedValue(error), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
      expect(vi.mocked(db.fail).mock.calls[0][5]).toMatchObject({
        llms: { terminal: { upstream_transport: upstreamTransport } },
      });
    }
  });

  it("preserves a fixed allowlisted provider error code from a failed terminal", async () => {
    const db = store();
    const error = new GatewayError("upstream_failed", "Upstream returned a terminal error", undefined, {
      terminalStatus: "failed", upstreamErrorCode: "server_error", upstreamResponseId: "resp-failed",
    });
    const result = await runOnce({ store: db, gateway: vi.fn().mockRejectedValue(error), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(result.status).toBe("failed");
    expect(db.finalize).not.toHaveBeenCalled();
    expect(db.fail).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", "failed", expect.any(String), expect.objectContaining({
      llms: { terminal: { status: "failed", error: { code: "server_error" }, upstream_response_id: "resp-failed" } },
    }));
  });

  it("persists a validated envelope with clean prose and marks malformed extraction incomplete", async () => {
    const db = store();
    db.context = vi.fn().mockResolvedValue('{"sport":"mlb"}');
    const envelope = { version: 1, sport: "mlb", events: [{ event_key: "mlb:2026-09-25:bos@nyy:id-123456", label: "Boston at New York", starts_at: null, source_url: verified.sources[0].url, analysis_status: "WAIT" }], recommendations: [{ item_key: "main", event_key: "mlb:2026-09-25:bos@nyy:id-123456", market: "Moneyline", selection: "Boston", decision: "WAIT", suggested_units: null, price_gate: null }] };
    await runOnce({ store: db, gateway: vi.fn().mockResolvedValue({ ...verified, text: `분석 내용\n\n\`\`\`analysis-record\n${JSON.stringify(envelope)}\n\`\`\`` }), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(db.finalize).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", expect.not.stringContaining("analysis-record"), expect.objectContaining({ extraction_status: "complete", analysis_record: envelope, recommendations_persisted: true }), "upstream-1");
    const second = store();
    second.context = vi.fn().mockResolvedValue('{"sport":"mlb"}');
    const malformed = "분석 내용\n\n```analysis-record\n{bad}\n```";
    await runOnce({ store: second, gateway: vi.fn().mockResolvedValue({ ...verified, text: malformed }), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(second.finalize).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", expect.stringContaining(malformed), expect.objectContaining({ extraction_status: "incomplete", extraction_failure: { code: "invalid_json", path: "analysis-record", message: expect.any(String) }, original_model_response: malformed, recommendations_persisted: false }), "upstream-1");
    expect(vi.mocked(second.finalize).mock.calls[0][3]).toContain("구조화 기록 추출 미완료");
    expect(vi.mocked(second.finalize).mock.calls[0][4]).not.toHaveProperty("analysis_record");
  });

  it("persists a synthetic 6-of-8 event and 12-of-14 recommendation subset as partial", async () => {
    const db = store();
    db.context = vi.fn().mockResolvedValue('{"sport":"mlb"}');
    const events = Array.from({ length: 8 }, (_, index) => ({
      event_key: `mlb:2026-10-30:away${index}@home${index}:id-${String(100000 + index)}`,
      label: `Away ${index} at Home ${index}`,
      starts_at: "2026-10-30T19:00:00-04:00",
      source_url: index < 6 ? `https://www.mlb.com/game/${1000 + index}` : `https://www.mlb.com/unsearched/${1000 + index}`,
      analysis_status: "WAIT",
    }));
    const recommendations = events.flatMap((event, index) => index < 6
      ? [
          { item_key: `game-${index}`, event_key: event.event_key, market: "Moneyline", selection: `Away ${index}`, decision: "WAIT", suggested_units: null, price_gate: null },
          { item_key: `total-${index}`, event_key: event.event_key, market: "Total", selection: "Under", decision: "WAIT", suggested_units: null, price_gate: null },
        ]
      : [{ item_key: `game-${index}`, event_key: event.event_key, market: "Moneyline", selection: `Away ${index}`, decision: "WAIT", suggested_units: null, price_gate: null }]);
    const envelope = {
      version: 1,
      sport: "mlb",
      events,
      recommendations,
    };
    const sources = events.slice(0, 6).map((event, index) => ({ title: `MLB fixture ${index}`, url: event.source_url }));
    const prose = events.map(event => `${event.label} [${event.source_url}]`).join("; ");
    const raw = `${prose}\n\n\`\`\`analysis-record\n${JSON.stringify(envelope)}\n\`\`\``;
    const result = await runOnce({
      store: db,
      gateway: vi.fn().mockResolvedValue({ ...verified, sources, text: raw }),
      workerId: "worker-1",
      baseUrl: "https://gateway.test/v1",
      apiKey: "secret",
      expectedModel: "gpt-6-astra",
      now: () => new Date("2026-10-27T15:00:00Z"),
    });
    expect(result.status).toBe("completed");
    const [call] = vi.mocked(db.finalize).mock.calls;
    expect(call[3]).toContain(prose);
    expect(call[3]).toContain("출처 자격 검증에서 제외된 2개 경기 행과 연결된 2개 추천 행");
    expect(call[3]).not.toContain("구조화 기록 추출 미완료; 분석 원문만 저장됨");
    expect(call[4]).toMatchObject({
      extraction_status: "partial",
      original_model_response: raw,
      sources,
      recommendations_persisted: true,
      analysis_record: {
        events: events.slice(0, 6).map(event => expect.objectContaining({ event_key: event.event_key })),
        recommendations: recommendations.slice(0, 12).map(item => expect.objectContaining({ item_key: item.item_key, event_key: item.event_key })),
      },
      record_admission: {
        raw_sha256: createHash("sha256").update(raw).digest("hex"),
        input_event_count: 8,
        input_recommendation_count: 14,
        accepted_event_keys: events.slice(0, 6).map(event => event.event_key),
        accepted_recommendation_item_keys: recommendations.slice(0, 12).map(item => item.item_key),
        rejected_events: [
          { index: 6, event_key: events[6].event_key, code: "unverified_source", path: "events.6.source_url" },
          { index: 7, event_key: events[7].event_key, code: "unverified_source", path: "events.7.source_url" },
        ],
        rejected_recommendations: [
          { index: 12, item_key: recommendations[12].item_key, event_key: events[6].event_key, code: "rejected_event_dependency", path: "recommendations.12.event_key" },
          { index: 13, item_key: recommendations[13].item_key, event_key: events[7].event_key, code: "rejected_event_dependency", path: "recommendations.13.event_key" },
        ],
      },
    });
  });

  it("finalizes a no-ID matchup with a server-derived key and zero-unit PASS", async () => {
    const db = store();
    db.context = vi.fn().mockResolvedValue('{"sport":"wnba"}');
    const url = "https://www.wnba.com/playoffs/2026/matchups";
    const cited = "https://WWW.WNBA.COM:443/playoffs/2026/matchups";
    const key = "wnba:2026-09-25:atl@lv:src";
    const derived = `${key}-${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
    const envelope = { version: 1, sport: "wnba", events: [{ event_key: key, label: "Atlanta at Las Vegas", starts_at: null, source_url: cited, analysis_status: "WATCH" }], recommendations: [{ item_key: "main", event_key: key, market: "Spread", selection: "Atlanta", decision: "PASS", suggested_units: 0, price_gate: null }] };
    const text = `분석 내용 [공식 출처](${cited})\n\n\`\`\`analysis-record\n${JSON.stringify(envelope)}\n\`\`\``;
    await runOnce({ store: db, gateway: vi.fn().mockResolvedValue({ ...verified, sources: [{ title: "WNBA", url }], text }), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    const metadata = vi.mocked(db.finalize).mock.calls[0][4];
    expect(metadata).toMatchObject({ extraction_status: "complete", recommendations_persisted: true, analysis_record: { events: [{ event_key: derived, source_url: url }], recommendations: [{ event_key: derived, decision: "PASS", suggested_units: 0 }] } });
  });

  it("fails without finalizing when the search has no verifiable source", async () => {
    const db = store();
    const result = await runOnce({ store: db, gateway: vi.fn().mockResolvedValue({ ...verified, sources: [], verified: false }), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(result.status).toBe("failed");
    expect(db.finalize).not.toHaveBeenCalled();
    expect(db.fail).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", "failed", expect.stringContaining("응답은 완료됐지만 검증 가능한 출처가 없어"), expect.objectContaining({
      code: "source_verification_failed", searched: true, verified: false, source_count: 0,
      original_model_response: verified.text, upstreamResponseId: verified.upstreamResponseId,
    }));
  });

  it("distinguishes an uncompleted search from a completed response without sources", async () => {
    const db = store();
    const result = await runOnce({ store: db, gateway: vi.fn().mockResolvedValue({ ...verified, searched: false, verified: false, sources: [] }), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(result.status).toBe("failed");
    expect(db.finalize).not.toHaveBeenCalled();
    expect(db.fail).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", "failed", expect.stringContaining("검색을 완료하지 못해"), expect.objectContaining({
      code: "source_verification_failed", searched: false, verified: false, source_count: 0,
      original_model_response: verified.text,
    }));
  });

  it("rejects unexpected persisted model before sending a paid request", async () => {
    const db = store();
    db.claim = vi.fn().mockResolvedValue({ ...job, model: "other-model" });
    const gateway = vi.fn();
    const result = await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(result.status).toBe("failed");
    expect(gateway).not.toHaveBeenCalled();
    expect(db.heartbeat).not.toHaveBeenCalled();
  });

  it("uses medium effort only for a simple status check", async () => {
    const db = store();
    db.claim = vi.fn().mockResolvedValue({ ...job, kind: "check_status", effort: "medium" });
    const gateway = vi.fn().mockResolvedValue(verified);
    const result = await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(result.status).toBe("completed");
    expect(gateway).toHaveBeenCalledWith(expect.objectContaining({ effort: "medium" }));
  });

  it("classifies only confirmed quota errors as waiting_quota", () => {
    expect(classifyGatewayFailure(new GatewayError("insufficient_quota", "exhausted", 429)).status).toBe("waiting_quota");
    expect(classifyGatewayFailure(new GatewayError("gateway_rate_limited", "rate limited", 429)).status).not.toBe("waiting_quota");
    expect(classifyGatewayFailure(new GatewayError("gateway_unauthorized", "expired", 401)).status).toBe("relogin_required");
    expect(classifyGatewayFailure(new GatewayError("upstream_interrupted", "missing terminal")).status).toBe("interrupted");
  });

  it("does not finalize after losing the execution lease", async () => {
    const db = store();
    db.heartbeat = vi.fn().mockResolvedValue(false);
    const gateway = vi.fn();
    const result = await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" });
    expect(result.status).toBe("lease_lost");
    expect(gateway).not.toHaveBeenCalled();
    expect(db.finalize).not.toHaveBeenCalled();
  });

  it("creates a bounded, traceable extract from old messages without replacing originals", () => {
    const messages = Array.from({ length: 60 }, (_, index) => ({
      id: `m-${60 - index}`, role: index % 2 ? "assistant" : "user",
      content: `message ${60 - index} ` + "x".repeat(2500), created_at: "2026-09-23T15:00:00Z",
    }));
    const original = structuredClone(messages);
    const candidate = buildSummaryCandidate(messages, new Set(["m-1"]));
    expect(candidate?.source_message_ids).toHaveLength(20);
    expect(candidate?.source_message_ids).not.toContain("m-1");
    expect(candidate?.content).toContain("m-2");
    expect(messages).toEqual(original);
    expect(buildSummaryCandidate(messages.slice(0, 40), new Set())).toBeNull();
  });
});

const chatPurpose = { version: 1, intent: "conversation", basis: "general", referenced_message_ids: [], requires_fresh_data: false };
const chatReply = (purpose: unknown = chatPurpose, body = "질문에 대한 답변입니다.") => `${body}\n\n\`\`\`response-purpose\n${JSON.stringify(purpose)}\n\`\`\``;
async function runChat(request: string, text = chatReply(), overrides: Partial<GatewayResult> = {}, kind = "message") {
  const db = store();
  db.claim = vi.fn().mockResolvedValue({ ...job, kind, effort: kind === 'check_status' ? 'medium' : job.effort });
  db.context = vi.fn().mockResolvedValue(JSON.stringify({ sport: "mlb", new_request: request, recent_messages: [{id:"past-1",role:"assistant",content:"PASS"}] }));
  const gateway = vi.fn().mockResolvedValue({ ...verified, searched: false, verified: false, sources: [], text, ...overrides });
  const result = await runOnce({store:db,gateway,workerId:"worker-1",baseUrl:"https://gateway.test/v1",apiKey:"secret",expectedModel:"gpt-6-astra"});
  return {db,gateway,result};
}
describe("free natural conversation", () => {
  it.each(["안녕, 어떻게 지내?","뭐가 문제였어?","내가 대화도 할 수 있어야 하는거 아니야?","왜 PASS였어?","분석 작업 왜 실패했어?","기준을 잘못 이해했어","들어갔어 - 양키스 ML -110"])("completes varied ordinary messages without invented search %s", async request => {
    const {db,gateway,result} = await runChat(request);
    expect(result.status).toBe("completed");
    expect(db.finalize).not.toHaveBeenCalled();
    expect(db.finalizeConversation).toHaveBeenCalledWith("job-1","attempt-1","worker-1","질문에 대한 답변입니다.",expect.objectContaining({type:"conversation",result_type:"conversation",searched:false,verified:false,original_model_response:chatReply(),recommendations_persisted:false}),"upstream-1");
    expect(gateway).toHaveBeenCalledWith(expect.objectContaining({toolChoice:"auto"}));
    const snapshot = vi.mocked(db.saveInputSnapshot).mock.calls[0][3];
    expect(snapshot.instructions).toContain("response-purpose");
    expect(snapshot.instructions_sha256).toBe(createHash("sha256").update(String(snapshot.instructions)).digest("hex"));
  });
  it.each(["답변",chatReply({...chatPurpose,referenced_message_ids:["fake"]}),chatReply({...chatPurpose,intent:"mixed"}),chatReply(chatPurpose,"기록\n\`\`\`analysis-record\n{}\n\`\`\`"),chatReply(chatPurpose,"기록\n\`\`\` ANALYSIS_RECORD\n{}\n\`\`\`")])("persists fixed clarification on invalid contract without writes",async text => {
    const {db,result} = await runChat("뭐가 문제였어?",text);
    expect(result.status).toBe("completed");
    expect(db.finalize).not.toHaveBeenCalled();
    const call = vi.mocked(db.finalizeConversation).mock.calls[0];
    expect(call[3]).toContain("확인");
    expect(call[3]).not.toContain("analysis-record");
    expect(call[4]).toMatchObject({original_model_response:text,recommendations_persisted:false});
    expect(call[4]).not.toHaveProperty("analysis_record");
    expect(call[4]).not.toHaveProperty("coverage_report");
  });
  it.each(["current_analysis","mixed"])("requires fresh verified sources for %s",async intent => {
    const {db,result} = await runChat("경기를 봐줘",chatReply({...chatPurpose,intent,basis:"fresh_web",requires_fresh_data:true}));
    expect(result.status).toBe("failed"); expect(db.finalizeConversation).not.toHaveBeenCalled(); expect(db.finalize).not.toHaveBeenCalled();
  });
  it("cannot downgrade unmistakable latest request based on a conversation label",async () => {
    const {db,result} = await runChat("오늘 경기 분석해줘");
    expect(result.status).toBe("failed"); expect(db.finalizeConversation).not.toHaveBeenCalled();
  });
  it("explicit actions remain strict even when model labels its output conversation",async () => {
    const {db,result} = await runChat("뭐가 문제였어?",chatReply(),{},"analyze_today");
    expect(result.status).toBe("failed"); expect(db.finalizeConversation).not.toHaveBeenCalled();
  });
  it("sourced conversation stays conversation and preserves truthful source audit",async () => {
    const {db,result} = await runChat("일반 원리를 설명해줘",chatReply({...chatPurpose,basis:"fresh_web"}),{sources:verified.sources,searched:true,verified:true});
    expect(result.status).toBe("completed"); expect(db.finalize).not.toHaveBeenCalled();
    expect(vi.mocked(db.finalizeConversation).mock.calls[0][4]).toMatchObject({sources:verified.sources,searched:true,verified:true});
  });
});

describe("conversation storage and boundaries", () => {
 it("calls the isolated atomic conversation RPC with the existing argument contract",async () => {
  const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({data:"assistant-id",error:null}) });
  const db = createSupabaseWorkerStore({rpc} as unknown as import("@supabase/supabase-js").SupabaseClient);
  expect(await db.finalizeConversation("job","attempt","worker","answer",{type:"conversation"},"provider")).toBe("assistant-id");
  expect(rpc).toHaveBeenCalledWith("finalize_gateway_completion",{p_job_id:"job",p_attempt_id:"attempt",p_worker_id:"worker",p_content:"answer",p_metadata:{type:"conversation"},p_provider_response_id:"provider",p_conversation:true});
 });
 it("strips purpose before strict extraction for a mixed response with real search",async () => {
  const text=chatReply({...chatPurpose,intent:"mixed",basis:"fresh_web",requires_fresh_data:true},`이전 판단은 PASS였습니다. 최신 확인 결과입니다.\n\`\`\`analysis-record\n${JSON.stringify({version:1,sport:"mlb",events:[],recommendations:[]})}\n\`\`\``);
  const {db,result}=await runChat("왜 PASS였고 지금 배당은 확인해줘?",text,{searched:true,verified:true,sources:verified.sources});
  expect(result.status).toBe("completed"); expect(db.finalizeConversation).not.toHaveBeenCalled();
  const call=vi.mocked(db.finalize).mock.calls[0];
  expect(call[3]).not.toContain("response-purpose"); expect(call[3]).not.toContain("analysis-record");
  expect(call[4]).toMatchObject({original_model_response:text,response_purpose:{intent:"mixed"},extraction_status:"complete",analysis_record:{events:[],recommendations:[]}});
 });
 it("persists a fixed clarification for invalid latest contracts even without sources",async () => {
  const {db,result}=await runChat("오늘 경기 분석해줘","형식이 잘못된 응답");
  expect(result.status).toBe("completed"); expect(db.finalize).not.toHaveBeenCalled();
  expect(vi.mocked(db.finalizeConversation).mock.calls[0][4]).toMatchObject({response_purpose_status:"invalid",searched:false,verified:false});
 });
 it("never finalizes a conversation after losing ownership",async () => {
  const db=store(); db.claim=vi.fn().mockResolvedValue({...job,kind:"message"});
  db.heartbeat=vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const result=await runOnce({store:db,gateway:vi.fn().mockResolvedValue({...verified,text:chatReply(),searched:false,verified:false,sources:[]}),workerId:"worker-1",baseUrl:"https://gateway.test/v1",apiKey:"secret",expectedModel:"gpt-6-astra"});
  expect(result.status).toBe("lease_lost"); expect(db.finalizeConversation).not.toHaveBeenCalled();
 });
});
it("does not publish conversation that claims fresh web basis without actual evidence",async () => {
 const {db,result}=await runChat("일반 원리를 설명해줘",chatReply({...chatPurpose,basis:"fresh_web"}));
 expect(result.status).toBe("completed");
 const call=vi.mocked(db.finalizeConversation).mock.calls[0];
 expect(call[3]).not.toBe("질문에 대한 답변입니다.");
 expect(call[4]).toMatchObject({response_purpose_status:"invalid",response_purpose_failure:"purpose_fresh_evidence_missing",searched:false,verified:false,response_purpose:{basis:"general"}});
});

const recoveryAccount = "66666666-6666-6666-6666-666666666666";

describe("bounded transport recovery", () => {
  afterEach(() => vi.useRealTimers());
  const recoverable = (extra = {}) => new GatewayError("upstream_interrupted", "private raw error", undefined, {
    terminalStatus: "interrupted", upstreamErrorCode: "upstream_transport_error", upstreamTransport: "ws",
    transportErrorKind: "unexpected_eof", upstreamResponseId: "resp-first", ...extra,
  }, recoveryAccount);
  const execute = (db: WorkerStore, gateway: Parameters<typeof runOnce>[0]["gateway"], extra = {}) => runOnce({
    store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra", ...extra,
  });
  it("starts one fresh generation with identical input and records both safe attempts", async () => {
    vi.useFakeTimers(); const db = store();
    const gateway = vi.fn().mockRejectedValueOnce(recoverable()).mockResolvedValue(verified);
    const pending = execute(db, gateway); await vi.runAllTimersAsync();
    expect((await pending).status).toBe("completed");
    expect(gateway).toHaveBeenCalledTimes(2);
    expect(gateway.mock.calls[0][0]).not.toHaveProperty("transportRecovery");
    expect(gateway.mock.calls[1][0]).toMatchObject({ transportRecovery: { transport: "http", accountId: recoveryAccount } });
    expect(gateway.mock.calls[1][0]).toMatchObject({ context: gateway.mock.calls[0][0].context, instructions: gateway.mock.calls[0][0].instructions, model: "gpt-6-astra", effort: "xhigh" });
    expect(db.saveInputSnapshot).toHaveBeenCalledTimes(1);
    expect(db.finalize).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.finalize).mock.calls[0][4]).toMatchObject({ transport_recovery: { attempt_count: 2, recovered: 1, attempts: [
      { status: "interrupted", upstream_response_id: "resp-first", transport_error_kind: "unexpected_eof" },
      { status: "completed", upstream_response_id: "upstream-1" },
    ] } });
    expect(JSON.stringify(vi.mocked(db.finalize).mock.calls[0][4])).not.toContain("private raw error");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stops after two interruptions and maps the last response ID to failure RPC metadata", async () => {
    vi.useFakeTimers(); const db = store(); const gateway = vi.fn().mockRejectedValue(recoverable());
    const pending = execute(db, gateway); await vi.runAllTimersAsync();
    expect((await pending).status).toBe("interrupted");
    expect(gateway).toHaveBeenCalledTimes(2); expect(db.fail).toHaveBeenCalledTimes(1); expect(db.finalize).not.toHaveBeenCalled();
    expect(vi.mocked(db.fail).mock.calls[0][5]).toMatchObject({ upstreamResponseId: "resp-first", transport_recovery: { attempt_count: 2, recovered: 0 } });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    { transportErrorKind: "unknown_transport_error" }, { upstreamTransport: "http" }, { requestContextCancelled: true },
    { websocketMessageTooBig: true }, { websocketProtocolError: true }, { websocketCloseCode: 1000 }, { websocketCloseCode: 1001 },
    { terminalStatus: "failed" }, { terminalStatus: "incomplete" }, { terminalStatus: "cancelled" }, { upstreamErrorCode: "upstream_timeout" },
    { transportErrorKind: "deadline_exceeded", websocketCloseCode: 1011 },
    { transportErrorKind: "context_cancelled", websocketCloseCode: 1011 },
    { transportErrorKind: "scanner_token_too_long", websocketCloseCode: 1011 },
  ])("does not recover excluded diagnostics %j", async extra => {
    vi.useFakeTimers(); const db = store(); const gateway = vi.fn().mockRejectedValue(recoverable(extra));
    const pending = execute(db, gateway); await vi.runAllTimersAsync(); await pending; expect(gateway).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, "invalid-account", "Bearer-private-token", "00000000-0000-0000-0000-000000000000"])("stops eligible interruptions without a valid selected-account hint (%s)", async hint => {
    vi.useFakeTimers(); const db = store();
    const gateway = vi.fn().mockRejectedValue(new GatewayError("upstream_interrupted", "private", undefined, { terminalStatus: "interrupted", upstreamErrorCode: "upstream_transport_error", upstreamTransport: "ws", transportErrorKind: "unexpected_eof" }, hint));
    const pending = execute(db, gateway); await vi.runAllTimersAsync();
    expect((await pending).status).toBe("interrupted"); expect(gateway).toHaveBeenCalledTimes(1); expect(db.finalize).not.toHaveBeenCalled();
  });
  it.each([1011, 1012, 1013])("recovers a transient WebSocket close %i", async websocketCloseCode => {
    vi.useFakeTimers(); const db = store();
    const gateway = vi.fn().mockRejectedValueOnce(recoverable({ transportErrorKind: "connection_closed", websocketCloseCode })).mockResolvedValue(verified);
    const pending = execute(db, gateway); await vi.runAllTimersAsync(); expect((await pending).status).toBe("completed");
  });
  it("does not retry without an authoritative lease heartbeat", async () => {
    const db = store(); db.heartbeat = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const gateway = vi.fn().mockRejectedValue(recoverable());
    expect((await execute(db, gateway)).status).toBe("lease_lost");
    expect(gateway).toHaveBeenCalledTimes(1); expect(db.fail).not.toHaveBeenCalled();
  });
  it("aborts the in-flight request when lease ownership is lost", async () => {
    vi.useFakeTimers(); const db = store(); db.heartbeat = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    let signal: AbortSignal | undefined;
    const gateway = vi.fn(async (options: import("./gateway").GatewayOptions) => {
      signal = options.signal;
      return await new Promise<GatewayResult>((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(recoverable()), { once: true }));
    });
    const pending = execute(db, gateway); await vi.advanceTimersByTimeAsync(30_000);
    expect(signal?.aborted).toBe(true); expect((await pending).status).toBe("lease_lost"); expect(db.finalize).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("shares the absolute deadline across both generations", async () => {
    vi.useFakeTimers(); const db = store(); let calls = 0;
    const gateway = vi.fn(async (options: import("./gateway").GatewayOptions) => {
      if (++calls === 1) { await new Promise(resolve => setTimeout(resolve, 59_000)); throw recoverable(); }
      return await new Promise<GatewayResult>((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(recoverable()), { once: true }));
    });
    const pending = execute(db, gateway, { upstreamTimeoutSeconds: 60 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await pending).status).toBe("interrupted"); expect(gateway).toHaveBeenCalledTimes(2);
    expect(vi.mocked(db.fail).mock.calls[0][5]).toMatchObject({ llms: { terminal: { error: { code: "upstream_timeout" } } } });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([false, true])("ignores a forward wall-clock jump during generation (recover=%s)", async recover => {
    vi.useFakeTimers(); const db = store(); let calls = 0;
    const gateway = vi.fn(async () => {
      if (++calls === 1) {
        vi.setSystemTime(Date.now() + 3_600_000);
        if (recover) throw recoverable();
      }
      return verified;
    });
    const pending = execute(db, gateway, { upstreamTimeoutSeconds: 60 });
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe("completed");
    expect(gateway).toHaveBeenCalledTimes(recover ? 2 : 1);
    expect(db.finalize).toHaveBeenCalledTimes(1); expect(db.fail).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("records lease loss during recovery backoff without replacing the original transport cause", async () => {
    vi.useFakeTimers(); const db = store();
    db.claim = vi.fn().mockResolvedValue({ ...job, id: "11111111-1111-1111-1111-111111111111", current_attempt_id: "22222222-2222-2222-2222-222222222222" });
    db.recordDiagnostics = vi.fn().mockResolvedValue("applied");
    db.heartbeat = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
    const gateway = vi.fn().mockRejectedValue(recoverable());
    const pending = execute(db, gateway, { heartbeatIntervalMs: 10 }); await vi.advanceTimersByTimeAsync(1_000);
    expect((await pending).status).toBe("lease_lost"); expect(gateway).toHaveBeenCalledTimes(1); expect(db.fail).not.toHaveBeenCalled();
    expect(vi.mocked(db.recordDiagnostics).mock.calls.at(-1)![4]).toMatchObject({ phase: "finished", transports: [{ root_cause: "unexpected_eof", retry_decision: "stop", retry_reason: "lease_lost", cancellation_origin: "lease_lost" }] });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([false, true])("prevents a second generation when the budget expires during recovery (checkpoint stalls=%s)", async stalls => {
    vi.useFakeTimers(); const db = store();
    db.claim = vi.fn().mockResolvedValue({ ...job, id: "11111111-1111-1111-1111-111111111111", current_attempt_id: "22222222-2222-2222-2222-222222222222" });
    db.recordDiagnostics = vi.fn(async (_j, _a, _w, sequence) => stalls && sequence === 3 ? await new Promise<string>(() => {}) : "applied");
    const gateway = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 59_900)); throw recoverable({ upstreamElapsedMs: 59_900, lastEventAgeMs: 4, eventCount: 77, lastEventType: "response.web_search_call.searching", requestContextCancelled: false, websocketCloseCode: 1011 }); });
    const pending = execute(db, gateway, { upstreamTimeoutSeconds: 60 }); await vi.advanceTimersByTimeAsync(stalls ? 62_000 : 60_000);
    expect((await pending).status).toBe("interrupted"); expect(gateway).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    const metadata = vi.mocked(db.fail).mock.calls[0][5];
    expect(metadata).toMatchObject({ upstreamResponseId: "resp-first", transport_recovery: { attempts: [{ status: "interrupted", transport_error_kind: "unexpected_eof", upstream_elapsed_ms: 59_900, event_count: 77, last_event_type: "response.web_search_call.searching", request_context_cancelled: false, websocket_close_code: 1011 }] } });
    expect((metadata.llms as { terminal: unknown }).terminal).toEqual({ status: "interrupted", error: { code: "upstream_timeout" }, transport_error_kind: "deadline_exceeded", upstream_response_id: "resp-first", upstream_transport: "ws" });
    expect(metadata).toMatchObject({ diagnostics: { phase: "finished", transports: [{ root_cause: "unexpected_eof", retry_decision: "stop", retry_reason: "deadline", cancellation_origin: "worker_deadline", event_count: 77 }] } });
    expect(vi.mocked(db.recordDiagnostics).mock.calls.at(-1)![4]).toEqual(metadata.diagnostics);
  });
});

it.each(["completed", "interrupted", "failed"])("uses one same-account HTTP recovery through the real parser (HTTP terminal=%s)", async secondStatus => {
  vi.useFakeTimers();
  try {
    const db = store(); const requests: Record<string, unknown>[] = []; const requestHeaders: Headers[] = []; const logs: unknown[] = [];
    db.claim = vi.fn().mockResolvedValue({ ...job, id: "11111111-1111-1111-1111-111111111111", current_attempt_id: "22222222-2222-2222-2222-222222222222" });
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body))); requestHeaders.push(new Headers(init?.headers));
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const first = requests.length === 1;
      const events = [
        { choices: [{ delta: { content: first ? "DISCARDED PARTIAL" : "Fresh answer" } }], llms: { hosted_tools: [{ name: "web_search", status: "completed", action: { sources: [{ title: first ? "Partial" : "Final", url: first ? "https://partial.example.com" : "https://final.example.com" }] } }] } },
        { llms: { terminal: first ? { status: "interrupted", upstream_response_id: "resp-partial", error: { code: "upstream_transport_error" }, upstream_transport: "ws", transport_error_kind: "unexpected_eof", diagnostics: { schema_version: 1, upstream_transport: "ws", upstream_http_status: 101 } } : { status: secondStatus, upstream_response_id: "resp-final", upstream_transport: "http", error: secondStatus === "completed" ? undefined : { code: "upstream_transport_error" }, diagnostics: { schema_version: 1, upstream_transport: "http", upstream_http_status: 200 } } } },
      ];
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream", "X-LLMs-Account-Id": recoveryAccount } });
    };
    const pending = runOnce({ store: db, gateway: options => runGatewayAnalysis({ ...options, fetchImpl }), workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra", diagnosticLogger: row => logs.push(row) });
    await vi.runAllTimersAsync(); const result = await pending;
    expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
    expect(requestHeaders[0].has("X-SportsDesk-Upstream-Transport")).toBe(false); expect(requestHeaders[0].has("X-SportsDesk-Recovery-Account-Id")).toBe(false);
    expect(requestHeaders[1].get("X-SportsDesk-Upstream-Transport")).toBe("http"); expect(requestHeaders[1].get("X-SportsDesk-Recovery-Account-Id")).toBe(recoveryAccount);
    expect(requestHeaders[1].get("X-SportsDesk-Transport-Attempt")).toBe("2");
    expect(requests[0]).toMatchObject({ model: "gpt-6-astra", reasoning_effort: "xhigh", llms: { web_search: { mode: "live" } }, tools: [{ type: "function", function: { name: "web_search" } }] });
    if (secondStatus === "completed") {
      expect(result.status).toBe("completed"); expect(db.finalize).toHaveBeenCalledTimes(1); expect(db.fail).not.toHaveBeenCalled();
      const saved = vi.mocked(db.finalize).mock.calls[0];
      expect(saved[3]).toContain("Fresh answer"); expect(JSON.stringify(saved)).not.toContain("DISCARDED PARTIAL"); expect(JSON.stringify(saved)).not.toContain("partial.example.com");
      expect(saved[4]).toMatchObject({ diagnostics: { transports: [{ upstream_transport: "ws", upstream_http_status: 101, gateway_http_status: 200 }, { upstream_transport: "http", upstream_http_status: 200, gateway_http_status: 200 }] }, transport_recovery: { attempts: [{ upstream_response_id: "resp-partial" }, { upstream_response_id: "resp-final" }] } });
    } else { expect(db.finalize).not.toHaveBeenCalled(); expect(db.fail).toHaveBeenCalledTimes(1); }
    expect(JSON.stringify([requests, logs, vi.mocked(db.finalize).mock.calls, vi.mocked(db.fail).mock.calls, vi.mocked(db.saveInputSnapshot).mock.calls])).not.toContain(recoveryAccount);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it("checkpoints ordered boundaries and retains both request identities despite checkpoint fencing or failure", async () => {
  vi.useFakeTimers();
  try {
    const db = store(); const uuidJob = { ...job, id: "11111111-1111-1111-1111-111111111111", current_attempt_id: "22222222-2222-2222-2222-222222222222" };
    db.claim = vi.fn().mockResolvedValue(uuidJob);
    const checkpoints: import("./diagnostics").Diagnostics[] = [];
    db.recordDiagnostics = vi.fn(async (_job, _attempt, _worker, sequence, diagnostics) => {
      checkpoints.push(structuredClone(diagnostics));
      if (sequence === 2) throw new Error("CANARY token storage");
      return sequence === 1 ? "fenced" : "applied";
    });
    const logs: unknown[] = [];
    const gateway = vi.fn().mockRejectedValueOnce(new GatewayError("upstream_interrupted", "CANARY raw error", undefined, { terminalStatus: "interrupted", upstreamErrorCode: "upstream_transport_error", upstreamTransport: "ws", transportErrorKind: "unexpected_eof", upstreamResponseId: "resp-first" }, recoveryAccount)).mockResolvedValue(verified);
    const pending = runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "CANARY", expectedModel: "gpt-6-astra", workerInstanceId: "33333333-3333-3333-3333-333333333333", diagnosticLogger: record => logs.push(record) });
    await vi.runAllTimersAsync(); expect((await pending).status).toBe("completed");
    expect(checkpoints.map(c => c.phase)).toEqual(["transport_started", "transport_ended", "retry_planned", "transport_started", "transport_ended", "finished"]);
    expect(checkpoints.map(c => c.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    const metadata = vi.mocked(db.finalize).mock.calls[0][4];
    expect(metadata).toMatchObject({ diagnostic_gap: true, diagnostics: { phase: "finished", transports: [{ transport_attempt: 1, upstream_response_id: "resp-first", root_cause: "unexpected_eof" }, { transport_attempt: 2, upstream_response_id: "upstream-1" }] } });
    const transports = checkpoints.at(-1)!.transports;
    expect(transports[0].request_id).not.toBe(transports[1].request_id);
    expect(gateway.mock.calls[0][0].correlation.requestId).toBe(transports[0].request_id);
    expect(JSON.stringify(logs)).not.toMatch(/CANARY|token storage|raw error/);
    expect(db.finalize).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it("bounds hanging diagnostic writes and ignores a throwing log sink without changing completion", async () => {
  vi.useFakeTimers();
  try {
    const db = store(); db.claim = vi.fn().mockResolvedValue({ ...job, id: "11111111-1111-1111-1111-111111111111", current_attempt_id: "22222222-2222-2222-2222-222222222222" });
    const signals: AbortSignal[] = [];
    db.recordDiagnostics = vi.fn(async (_j, _a, _w, _s, _d, signal) => { signals.push(signal!); return await new Promise<string>(() => {}); });
    const gateway = vi.fn().mockResolvedValue(verified);
    const pending = runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra", upstreamTimeoutSeconds: 60, workerInstanceId: "33333333-3333-3333-3333-333333333333", diagnosticLogger: () => { throw new Error("private log failure"); } });
    await vi.advanceTimersByTimeAsync(7_000);
    expect(db.finalize).toHaveBeenCalledTimes(1);
    expect((await pending).status).toBe("completed"); expect(gateway).toHaveBeenCalledTimes(1);
    expect(signals).toHaveLength(3); expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(vi.mocked(db.finalize).mock.calls[0][4]).toMatchObject({ diagnostic_gap: true });
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it("merges the actual Go fixture without replacing worker duration or losing upstream correlation", async () => {
  vi.useFakeTimers();
  try {
    const { readFileSync } = await import("node:fs");
    const fixture = JSON.parse(readFileSync("src/lib/analysis/fixtures/go-transport-diagnostics.json", "utf8"));
    const db = store(); db.claim = vi.fn().mockResolvedValue({ ...job, id: "11111111-1111-1111-1111-111111111111", current_attempt_id: "22222222-2222-2222-2222-222222222222" });
    db.recordDiagnostics = vi.fn().mockResolvedValue("applied"); let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      const first = ++calls === 1;
      const terminal = first ? { status: "interrupted", error: { code: "upstream_transport_error" }, upstream_transport: "ws", transport_error_kind: "unexpected_eof", upstream_elapsed_ms: 250, upstream_response_id: "resp_fixture_123", diagnostics: fixture } : { status: "completed", upstream_response_id: "resp-final" };
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "synthetic" } }], llms: { hosted_tools: [{ name: "web_search", status: "completed", action: { sources: [{ title: "Synthetic", url: "https://example.com" }] } }], terminal } })}\n\n`, { headers: { "content-type": "text/event-stream", "X-LLMs-Account-Id": recoveryAccount } });
    };
    const pending = runOnce({ store: db, gateway: options => runGatewayAnalysis({ ...options, fetchImpl }), workerId: "worker-1", workerInstanceId: "33333333-3333-3333-3333-333333333333", baseUrl: "https://gateway.test/v1", apiKey: "synthetic", expectedModel: "gpt-6-astra" });
    await vi.runAllTimersAsync(); expect((await pending).status).toBe("completed");
    const saved = vi.mocked(db.finalize).mock.calls[0][4];
    expect(saved).toMatchObject({ diagnostics: { transports: [{ upstream_request_id: "req_fixture_123", upstream_response_id: "resp_fixture_123", stage: "upstream_read", root_cause: "unexpected_eof", error_fingerprint: "f919181a2ded4fc546fb1f65a271c98292b4bfdd5d783e719e9fe3095c59f895", elapsed_ms: 0 }, { transport_attempt: 2, elapsed_ms: 0 }] }, transport_recovery: { attempts: [{ upstream_elapsed_ms: 250 }, { status: "completed" }] } });
    expect(vi.mocked(db.recordDiagnostics).mock.calls.at(-1)![4]).toEqual(saved.diagnostics);
  } finally { vi.useRealTimers(); }
});

it("does not fabricate an upstream terminal status for a rejected gateway HTTP request", async () => {
  const db = store(); db.claim = vi.fn().mockResolvedValue({ ...job, id: "11111111-1111-1111-1111-111111111111", current_attempt_id: "22222222-2222-2222-2222-222222222222" });
  await runOnce({ store: db, gateway: options => runGatewayAnalysis({ ...options, fetchImpl: async () => new Response("{}", { status: 401 }) }), workerId: "worker-1", workerInstanceId: "33333333-3333-3333-3333-333333333333", baseUrl: "https://gateway.test/v1", apiKey: "synthetic", expectedModel: "gpt-6-astra" });
  const diagnostics = vi.mocked(db.fail).mock.calls[0][5].diagnostics as import("./diagnostics").Diagnostics;
  expect(diagnostics.transports[0]).toMatchObject({ gateway_http_status: 401, root_cause: "http_rejected" });
  expect(diagnostics.transports[0]).not.toHaveProperty("upstream_terminal_status");
});

it("retains display candidates only in immutable raw and never in visible or stored analysis records",async()=>{
 const db=store();const scope={version:1,sport:"mlb",date_et:"2026-10-27",timezone:"America/New_York",mode:"daily",competitions:["MLB"],basis:"default"};
 db.context=vi.fn().mockResolvedValue(JSON.stringify({sport:"mlb",analysis_scope:scope}));
 const report={version:1,scope,inventory:[],assessments:[],schedule_sources:[],inventory_complete:false,limitations:[]};
 const raw=`Original answer\n\n\`\`\`analysis-coverage\n${JSON.stringify(report)}\n\`\`\`\n\n\`\`\`analysis-candidates\n{"version":1,"sport":"mlb","candidates":[]}\n\`\`\`\n\n\`\`\`analysis-record\n{"version":1,"sport":"mlb","events":[],"recommendations":[]}\n\`\`\``;
 await runOnce({store:db,gateway:vi.fn().mockResolvedValue({...verified,text:raw}),workerId:"worker-1",baseUrl:"https://gateway.test/v1",apiKey:"secret",expectedModel:"gpt-6-astra"});
 const call=vi.mocked(db.finalize).mock.calls[0];expect(call[3]).not.toContain("analysis-candidates");expect(call[4]).toMatchObject({original_model_response:raw,extraction_status:"complete",analysis_record:{events:[],recommendations:[]}});
});

it("rejects a conversation-purpose answer carrying display candidate payload",async()=>{
 const db=store();db.claim=vi.fn().mockResolvedValue({...job,kind:"message"});db.context=vi.fn().mockResolvedValue(JSON.stringify({sport:"mlb",new_request:"Explain the process",recent_messages:[]}));
 const raw=chatReply(chatPurpose,'Conversation\n```analysis-candidates\n{"version":1,"sport":"mlb","candidates":[]}\n```');
 await runOnce({store:db,gateway:vi.fn().mockResolvedValue({...verified,text:raw}),workerId:"worker-1",baseUrl:"https://gateway.test/v1",apiKey:"secret",expectedModel:"gpt-6-astra"});
 expect(vi.mocked(db.finalizeConversation).mock.calls[0][4]).toMatchObject({response_purpose_status:"invalid",response_purpose_failure:"conversation_analysis_payload"});expect(db.finalize).not.toHaveBeenCalled();
});

describe('evaluation diagnostics survive worker finalization', () => {
  it('strips malformed diagnostics on incomplete native extraction without retrying or losing raw response', async () => {
    const db = store(); const response = 'Useful analysis\n```analysis-evaluation\n{bad}\n```';
    const gateway = vi.fn().mockResolvedValue({ ...verified, text: response });
    expect((await runOnce({ store: db, gateway, workerId: 'worker-1', baseUrl: 'https://gateway.test/v1', apiKey: 'secret', expectedModel: 'gpt-6-astra' })).status).toBe('completed');
    const call = vi.mocked(db.finalize).mock.calls[0];
    expect(call[3]).toContain('Useful analysis'); expect(call[3]).not.toContain('analysis-evaluation');
    expect(call[4]).toMatchObject({ original_model_response: response, extraction_status: 'incomplete', evaluation_validation: { status: 'invalid' } });
    expect(gateway).toHaveBeenCalledTimes(1);
  });
});

describe('evaluation fences preserve canonical worker output', () => {
  it('keeps canonical extraction and durable recovered completion identical after malformed unclosed evaluation', async () => {
    const db = store();
    const scope = { version: 1, sport: 'mlb', date_et: '2026-10-28', timezone: 'America/New_York', mode: 'daily', competitions: ['MLB'], basis: 'default' };
    db.context = vi.fn().mockResolvedValue(JSON.stringify({ sport: 'mlb', analysis_scope: scope }));
    const record = { version: 1, sport: 'mlb', events: [], recommendations: [] };
    const raw = `No games\n\`\`\`analysis-evaluation\n{bad}\n\`\`\`analysis-coverage\n${JSON.stringify({ version: 1, scope, inventory: [], assessments: [], schedule_sources: [{ url: verified.sources[0].url, competition: 'MLB', expected_count: 0 }], inventory_complete: true, limitations: [] })}\n\`\`\`\n\`\`\`analysis-record\n${JSON.stringify(record)}\n\`\`\``;
    const gateway = vi.fn().mockResolvedValue({ ...verified, text: raw });
    await runOnce({ store: db, gateway, workerId: 'worker-1', baseUrl: 'https://gateway.test/v1', apiKey: 'secret', expectedModel: 'gpt-6-astra' });
    const saved = vi.mocked(db.finalize).mock.calls[0];
    expect(saved[4]).toMatchObject({ original_model_response: raw, analysis_record: record, extraction_status: 'complete', evaluation_validation: { status: 'invalid' } });
    expect(saved[3]).not.toContain('analysis-evaluation'); expect(saved[3]).not.toContain('analysis-record');
    const recovered = store(); recovered.loadCompletion = vi.fn().mockResolvedValue({ ...vi.mocked(db.saveCompletion).mock.calls[0][3], original_attempt_id: 'attempt-1', input_snapshot: vi.mocked(db.saveInputSnapshot).mock.calls[0][3] });
    const recoveryGateway = vi.fn();
    expect((await runOnce({ store: recovered, gateway: recoveryGateway, workerId: 'worker-2', baseUrl: 'https://gateway.test/v1', apiKey: 'secret', expectedModel: 'gpt-6-astra' })).status).toBe('completed');
    expect(recoveryGateway).not.toHaveBeenCalled();
    expect(vi.mocked(recovered.finalize).mock.calls[0][3]).toBe(saved[3]);
    expect(vi.mocked(recovered.finalize).mock.calls[0][4]).toMatchObject({ analysis_record: record, evaluation_validation: { status: 'invalid' }, original_model_response: raw });
  });
  it.each(['review_results', 'check_status'])('omits diagnostic metadata for %s without current market assessment', async kind => {
    const db = store(); db.claim = vi.fn().mockResolvedValue({ ...job, kind, effort: kind === 'check_status' ? 'medium' : job.effort });
    await runOnce({ store: db, gateway: vi.fn().mockResolvedValue(verified), workerId: 'worker-1', baseUrl: 'https://gateway.test/v1', apiKey: 'secret', expectedModel: 'gpt-6-astra' });
    expect(vi.mocked(db.finalize).mock.calls[0][4]).not.toHaveProperty('evaluation_validation');
  });
});

it.each(['id-123456', 'src'])('retains admitted WAIT recommendation unchanged while detecting source-independent diagnostic conflict (%s)', async suffix => {
  const db = store();
  const scope = { version: 1, sport: 'mlb', date_et: '2026-10-28', timezone: 'America/New_York', mode: 'daily', competitions: ['MLB'], basis: 'default' };
  db.context = vi.fn().mockResolvedValue(JSON.stringify({ sport: 'mlb', analysis_scope: scope }));
  const source = 'https://www.mlb.com/game/123456'; const schedule = 'https://www.mlb.com/schedule/2026-10-28'; const key = `mlb:2026-10-28:bos@nyy:${suffix}`; const label = 'Boston at New York';
  const recommendation = { item_key: 'main', event_key: key, market: 'Moneyline', selection: 'Boston', decision: 'WAIT', suggested_units: null, price_gate: null };
  const record = { version: 1, sport: 'mlb', events: [{ event_key: key, label, starts_at: '2026-10-28T23:00:00Z', source_url: source, analysis_status: 'WAIT' }], recommendations: [recommendation] };
  const coverage = { version: 1, scope, inventory: [{ event_key: key, label, starts_at: '2026-10-28T23:00:00Z', competition: 'MLB', source_url: schedule }], assessments: [{ event_key: key, disposition: 'evaluated', reason: 'Market assessed' }], schedule_sources: [{ url: schedule, competition: 'MLB', expected_count: 1 }], inventory_complete: true, limitations: [] };
  const report = { version: 1, sport: 'mlb', date_et: '2026-10-28', scope: 'selected_markets', scope_note: 'Boston moneyline only', truncated: false, markets: [{ event_key: key, label, market: 'Moneyline', selection: 'Boston', line: null, original_decision: 'GO', state: 'valuation_complete', observed_price: { value: '+110', source_url: source, checked_at: '2026-10-28T16:00:00Z' }, price_condition: '+100 or better', suggested_units: 1, thesis: 'Matchup advantage at quote', countercase: 'Bullpen may regress', critical_checks: ['participants', 'matchup', 'workload', 'dependencies'].map(category => ({ category, status: 'confirmed', evidence: 'Captured matchup evidence', source_urls: [source], checked_at: '2026-10-28T16:00:00Z' })), uncertainty: { impact: 'Starter health changes projection', scenario: 'Scratch removes edge', reopen_trigger: 'Confirmed lineup' } }] };
  const raw = `Boston at New York [source](${source}) [schedule](${schedule})\n\`\`\`analysis-coverage\n${JSON.stringify(coverage)}\n\`\`\`\n\`\`\`analysis-evaluation\n${JSON.stringify(report)}\n\`\`\`\n\`\`\`analysis-record\n${JSON.stringify(record)}\n\`\`\``;
  const gateway = vi.fn().mockResolvedValue({ ...verified, text: raw, sources: [{ title: 'MLB', url: source }, { title: 'Schedule', url: schedule }] });
  expect((await runOnce({ store: db, gateway, workerId: 'worker-1', baseUrl: 'https://gateway.test/v1', apiKey: 'secret', expectedModel: 'gpt-6-astra', now: () => new Date('2026-10-28T16:00:00Z') })).status).toBe('completed');
  const metadata = vi.mocked(db.finalize).mock.calls[0][4];
  const canonicalKey = suffix === 'src' ? sourcedEventKey(key, source) : key;
  const expectedRecord = { ...record, events: record.events.map(event => ({ ...event, event_key: canonicalKey })), recommendations: [{ ...recommendation, event_key: canonicalKey }] };
  expect(metadata).toMatchObject({ analysis_record: expectedRecord, evaluation_report: report, evaluation_validation: { status: 'valid', reasons: expect.arrayContaining(['canonical_decision_conflict:0', 'canonical_price_conflict:0', 'canonical_units_conflict:0']) } });
  expect(gateway).toHaveBeenCalledTimes(1);
  const hiddenDb = store(); hiddenDb.context = db.context;
  const hiddenRaw = raw.replace(`Boston at New York [source](${source})`, `No visible event [source](${source})`);
  await runOnce({ store: hiddenDb, gateway: vi.fn().mockResolvedValue({ ...verified, text: hiddenRaw, sources: [{ title: 'MLB', url: source }, { title: 'Schedule', url: schedule }] }), workerId: 'worker-1', baseUrl: 'https://gateway.test/v1', apiKey: 'secret', expectedModel: 'gpt-6-astra', now: () => new Date('2026-10-28T16:00:00Z') });
  expect(vi.mocked(hiddenDb.finalize).mock.calls[0][4]).toMatchObject({ original_model_response: hiddenRaw, coverage: { reasons: expect.arrayContaining([`body_inventory_missing:${key}`]) } });
});

it.each([
  ['오늘 경기 시작했어?', 'message', 'message', false],
  ['라인업 게시됐어?', 'message', 'message', false],
  ['오늘 경기 가격 평가해줘', 'message', 'message', true],
  ['라인업 재확인', 'message', 'recheck_lineup', true],
  ['라인업 재확인', 'recheck_lineup', 'recheck_lineup', true],
])('scopes evaluation diagnostics for %s', async (request, kind, scope_workflow, expected) => {
  const db = store(); db.claim = vi.fn().mockResolvedValue({ ...job, kind });
  db.context = vi.fn().mockResolvedValue(JSON.stringify({ sport: 'nba', scope_workflow, new_request: request }));
  const text = `Current response\n\`\`\`response-purpose\n${JSON.stringify({ version: 1, intent: 'current_analysis', basis: 'fresh_web', referenced_message_ids: [], requires_fresh_data: true })}\n\`\`\``;
  await runOnce({ store: db, gateway: vi.fn().mockResolvedValue({ ...verified, text }), workerId: 'worker-1', baseUrl: 'https://gateway.test/v1', apiKey: 'secret', expectedModel: 'gpt-6-astra' });
  expect('evaluation_validation' in vi.mocked(db.finalize).mock.calls[0][4]).toBe(expected);
});

it.each(["mlb", "nfl", "cfb", "soccer", "tennis", "nba", "wnba", "nhl"])("prepares results review once with unchanged Astra/xhigh/search and no current recommendation persistence (%s)", async sport => {
  const db = store(); db.claim = vi.fn().mockResolvedValue({ ...job, kind: "review_results" });
  const original = JSON.stringify({ sport, current_job_kind: "review_results", analysis_scope: { version: 1, sport, date_et: "2026-10-28", timezone: "America/New_York", mode: "explicit", competitions: [], basis: "request" }, scope_limitations: [], recent_messages: [{ id: "original", role: "assistant", content: "GO Alpha. PASS Beta. WAIT Gamma. Body-only miss Delta." }, { id: "user", role: "user", content: "Keep actual stake unknown" }], active_events: [{ id: "event", event_key: "known" }], relevant_recommendations: [{ id: "recommendation", event_id: "event", decision: "PASS" }], confirmed_bets: [{ id: "ticket", event_id: "event", result: "won", stake_units: 1, executed_price: 100 }], new_request: "Review all" });
  db.context = vi.fn().mockResolvedValue(original);
  const sourceAudit = { original_context_sha256: createHash("sha256").update(original).digest("hex"), source_messages: JSON.parse(original).recent_messages.map((row: { id: string; role: string; content: string }) => ({ id: row.id, role: row.role, content_sha256: createHash("sha256").update(row.content).digest("hex"), content_utf8_bytes: Buffer.byteLength(row.content, "utf8"), body_location: "recent_messages", evidence_status: "historical_recorded" })) };
  const gateway = vi.fn<typeof runGatewayAnalysis>(async () => {
    expect(vi.mocked(db.saveInputSnapshot).mock.calls[0][3]).toMatchObject({ review_preparation: { version: 1, local_only: true, source_audit: sourceAudit } });
    return { ...verified, text: "Reviewed wins, losses, PASS, WAIT and missed opportunity.", usageAvailable: true };
  });
  expect((await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" })).status).toBe("completed");
  const input = gateway.mock.calls[0][0];
  expect(input).toMatchObject({ model: "gpt-6-astra", effort: "xhigh", toolChoice: "required" });
  expect(JSON.parse(input.context).results_review).not.toHaveProperty("source_messages");
  expect(JSON.parse(input.context).results_review).not.toHaveProperty("original_context_sha256");
  expect(JSON.parse(input.context).results_review.review_obligation).toContain("body-only");
  expect(JSON.parse(input.context).recent_messages).toEqual(JSON.parse(original).recent_messages);
  expect(gateway).toHaveBeenCalledTimes(1);
  expect(vi.mocked(db.saveInputSnapshot).mock.calls[0][3]).toMatchObject({ context: input.context, original_context: original, instructions: input.instructions });
  const snapshot = vi.mocked(db.saveInputSnapshot).mock.calls[0][3];
  expect(snapshot.context_source_ids).toMatchObject({ active_events: ["event"], relevant_recommendations: ["recommendation"], confirmed_bets: ["ticket"] });
  const comparison = snapshot.review_input_comparison as { baseline: { context: { utf8_bytes: number }; total_utf8_bytes: number }; prepared: { context: { utf8_bytes: number }; total_utf8_bytes: number }; immutable_sources: { assistant_bodies: number; user_messages: number } };
  expect(comparison.baseline.context.utf8_bytes).toBe(Buffer.byteLength(original, "utf8"));
  expect(comparison.prepared.context.utf8_bytes).toBe(Buffer.byteLength(input.context, "utf8"));
  expect(comparison.prepared.total_utf8_bytes).toBeLessThan(comparison.baseline.total_utf8_bytes);
  expect(comparison.immutable_sources).toMatchObject({ assistant_bodies: 1, user_messages: 1 });
  const finalized = vi.mocked(db.finalize).mock.calls[0];
  expect(finalized[4]).toMatchObject({ review_input_comparison: comparison });
  expect(finalized[3]).toContain("Reviewed wins"); expect(finalized[3]).not.toContain("전체 일정 coverage");
  expect(finalized[4]).toMatchObject({ recommendations_persisted: false, results_review: { version: 1 }, review_usage: { provider: { input_tokens: 400, output_tokens: 100 } } });
  expect(finalized[4]).not.toHaveProperty("analysis_record");
  expect(JSON.stringify(finalized[4])).not.toContain('"source_messages"');
});

it.each([false, true, null])("recovers exact review input and stored preparation without model execution (separate audit=%s)", async separateAudit => {
  const db = store(); db.claim = vi.fn().mockResolvedValue({ ...job, kind: "review_results" });
  const exact = JSON.stringify({ sport: "tennis", results_review: { version: 1, ...(separateAudit ? {} : { original_context_sha256: "saved-original", source_messages: [{ id: "old-inline" }] }) }, recent_messages: [{ id: "original", role: "assistant", content: "original body" }] });
  const preparation = { version: 1, elapsed_ms: 19, local_only: true, ...(separateAudit ? { source_audit: { original_context_sha256: "captured-hash", source_messages: [{ id: "captured-source", role: "assistant", content_sha256: "captured-body-hash", content_utf8_bytes: 13, body_location: "recent_messages", evidence_status: "historical_recorded" }] } } : {}) };
  db.loadCompletion = vi.fn().mockResolvedValue({ version: 1, result: verified, checked_at: "2026-10-29T10:00:00Z", original_attempt_id: "attempt-original", input_snapshot: { context: exact, original_context: "ORIGINAL", ...(separateAudit === null ? {} : { review_preparation: preparation }), instructions: "EXACT OLD REVIEW INSTRUCTIONS", execution_time: "2026-10-29T09:00:00Z" } });
  const gateway = vi.fn();
  expect((await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" })).status).toBe("completed");
  expect(gateway).not.toHaveBeenCalled(); expect(db.context).not.toHaveBeenCalled();
  expect(vi.mocked(db.saveInputSnapshot).mock.calls[0][3]).toMatchObject({ context: exact, original_context: "ORIGINAL", instructions: "EXACT OLD REVIEW INSTRUCTIONS" });
  expect(vi.mocked(db.saveInputSnapshot).mock.calls[0][3].review_preparation).toEqual(separateAudit === null ? { version: 1, elapsed_ms: null, local_only: true } : preparation);
  expect(vi.mocked(db.finalize).mock.calls[0][4]).toMatchObject({ recommendations_persisted: false, review_usage: { recovered: true } });
});

it.each([false, true])("preserves optional malformed facts prose and raw checkpoint without promoting saved facts to verification (verified=%s)", async independentlyVerified => {
  const db = store(); db.claim = vi.fn().mockResolvedValue({ ...job, kind: "review_results" });
  db.context = vi.fn().mockResolvedValue(JSON.stringify({ sport: "tennis", recent_messages: [{ id: "prior", role: "assistant", content: "Stored win claim" }], confirmed_bets: [{ result: "won", stake_units: 1, executed_price: 100 }] }));
  const text = "Review answer\n```results-review-facts\n{malformed\n```";
  const gateway = vi.fn().mockResolvedValue({ ...verified, text, verified: independentlyVerified, searched: independentlyVerified, usageAvailable: false });
  expect((await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" })).status).toBe(independentlyVerified ? "completed" : "failed");
  expect(vi.mocked(db.saveCompletion).mock.calls[0][3].result.text).toBe(text);
  if (independentlyVerified) {
    expect(vi.mocked(db.finalize).mock.calls[0][4]).toMatchObject({ original_model_response: text, review_usage: { provider: { input_tokens: null, output_tokens: null } } });
  } else {
    expect(db.finalize).not.toHaveBeenCalled();
    expect(vi.mocked(db.fail).mock.calls[0][5]).toMatchObject({ code: "source_verification_failed", original_model_response: text });
  }
});


it.each([false, "error"])("blocks review execution when source audit snapshot cannot persist (%s)", async failure => {
  const db = store(); db.claim = vi.fn().mockResolvedValue({ ...job, kind: "review_results" });
  db.context = vi.fn().mockResolvedValue(JSON.stringify({ sport: "tennis", recent_messages: [{ id: "source", role: "assistant", content: "PASS and body-only WAIT" }] }));
  db.saveInputSnapshot = failure === false ? vi.fn().mockResolvedValue(false) : vi.fn().mockRejectedValue(new Error("offline"));
  const gateway = vi.fn();
  expect((await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "secret", expectedModel: "gpt-6-astra" })).status).toBe(failure === false ? "lease_lost" : "failed");
  expect(gateway).not.toHaveBeenCalled();
  expect(vi.mocked(db.saveInputSnapshot).mock.calls[0][3]).toHaveProperty("review_preparation.source_audit.source_messages.0.id", "source");
});
