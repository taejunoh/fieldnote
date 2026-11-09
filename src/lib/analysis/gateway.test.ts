import { createServer } from "node:http";
import { Agent, fetch as undiciFetch } from "undici";
import { describe, expect, it, vi } from "vitest";
import { runGatewayAnalysis, type GatewayOptions } from "./gateway";

const source = { title: "MLB Lineups", url: "https://www.mlb.com/starting-lineups" };

function sse(...events: unknown[]) {
  return new Response(
    events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

const options = {
  baseUrl: "http://127.0.0.1:8080/r/sports/v1",
  apiKey: "test-route-key",
  model: "gpt-6-astra",
  effort: "xhigh" as const,
  context: "오늘 MLB 확인",
  instructions: "출처를 표시해",
};

describe("openllms adapter", () => {
  it("forwards high reasoning effort to the gateway", async () => {
    let body = "";
    const highOptions: GatewayOptions = {
      ...options,
      effort: "high",
      fetchImpl: async (_url, init) => {
        body = String(init?.body);
        return sse({ choices: [{ delta: { content: "done" } }], llms: { terminal: { status: "completed" } } });
      },
    };
    await runGatewayAnalysis(highOptions);
    expect(JSON.parse(body)).toMatchObject({ reasoning_effort: "high" });
  });

  it.each(["failed", "incomplete", "cancelled", "interrupted"].flatMap(status => [
    { status, tail: "data: {malformed" },
    { status, tail: 'data: {"llms":{"terminal":{"status":"completed"}}}' },
    { status, tail: "data: {malformed\n\n" },
    { status, tail: 'data: {"llms":{"terminal":{"status":"completed"}}}\n\n' },
  ]))("preserves the first terminal $status despite an unframed trailing payload: $tail", async ({ status, tail }) => {
    const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }], llms: { terminal: { status, error: { code: "insufficient_quota" } } } })}\n\n`;
    await expect(runGatewayAnalysis({ ...options, fetchImpl: async () => new Response(frame + tail, { headers: { "content-type": "text/event-stream" } }) }))
      .rejects.toMatchObject({ safeDiagnostics: { terminalStatus: status, upstreamErrorCode: "insufficient_quota" } });
  });
  it.each(["", "\n\n"])("does not reverse a completed terminal after trailing failed data (%j)", async suffix => {
    const frame = 'data: {"choices":[{"delta":{"content":"completed answer"}}],"llms":{"terminal":{"status":"completed"}}}\n\n';
    const tail = 'data: {"llms":{"terminal":{"status":"failed","error":{"code":"insufficient_quota"}}}}';
    const result = await runGatewayAnalysis({ ...options, fetchImpl: async () => new Response(frame + tail + suffix, { headers: { "content-type": "text/event-stream" } }) });
    expect(result.text).toBe("completed answer");
    expect(result.safeDiagnostics?.terminalStatus).toBe("completed");
  });
  it.each(["failed", "incomplete", "cancelled", "interrupted"])("stops at terminal %s even when the stream stays open, without returning partial text", async status => {
    let closeStream: (() => void) | undefined;
    const cancelled = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        closeStream = () => controller.close();
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "private partial answer" } }], llms: { terminal: { status, error: { code: "insufficient_quota" } } } })}\n\n`));
      }, cancel: cancelled,
    });
    const pending = runGatewayAnalysis({ ...options, fetchImpl: async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }) }).then(() => "returned partial text", error => error);
    const outcome = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve("still waiting for EOF"), 50))]);
    if (outcome === "still waiting for EOF") closeStream?.();
    await pending;
    expect(outcome).toMatchObject({ safeDiagnostics: { terminalStatus: status, upstreamErrorCode: "insufficient_quota" } });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("uses its own Undici fetch transport when native fetch is incompatible", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "정상 응답" } }], llms: { terminal: { status: "completed" } } })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected an ephemeral HTTP port");
    const nativeFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("incompatible native dispatcher"));
    try {
      const result = await runGatewayAnalysis({ ...options, baseUrl: `http://127.0.0.1:${address.port}/r/sports/v1` });
      expect(result.text).toBe("정상 응답");
      expect(nativeFetch).not.toHaveBeenCalled();
    } finally {
      nativeFetch.mockRestore();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("uses extended Undici timeouts for a delayed SSE response", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "지연 응답" } }] })}\n\n`);
      setTimeout(() => {
        response.end(`data: ${JSON.stringify({ llms: { terminal: { status: "completed" } } })}\n\ndata: [DONE]\n\n`);
      }, 25);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected an ephemeral HTTP port");
    let dispatcher: unknown;
    const fetchImpl: typeof fetch = (input, init) => {
      dispatcher = (init as RequestInit & { dispatcher?: unknown }).dispatcher;
      return (undiciFetch as unknown as typeof fetch)(input, init);
    };

    try {
      const result = await runGatewayAnalysis({
        ...options,
        baseUrl: `http://127.0.0.1:${address.port}/r/sports/v1`,
        fetchImpl,
      });

      expect(result.text).toBe("지연 응답");
      expect(dispatcher).toBeInstanceOf(Agent);
      const timeoutOptions = Reflect.ownKeys(dispatcher as object)
        .map((key) => (dispatcher as Record<PropertyKey, unknown>)[key])
        .find((value): value is { headersTimeout: number; bodyTimeout: number } =>
          Boolean(value && typeof value === "object" && "headersTimeout" in value && "bodyTimeout" in value),
        );
      expect(timeoutOptions).toMatchObject({ headersTimeout: 46 * 60 * 1000, bodyTimeout: 46 * 60 * 1000 });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("requires a completed terminal event and structured web source", async () => {
    let sentBody = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      sentBody = String(init?.body || "");
      return sse(
        { choices: [{ delta: { content: "확인 결과" } }] },
        {
          choices: [{ delta: {}, finish_reason: "stop" }],
          model: "requested-model-alias",
          llms: {
            terminal: {
              status: "completed",
              upstream_response_id: "resp_123",
              upstream_reported_model: "gpt-6-astra-2026-09-15",
              upstream_reported_reasoning_mode: "adaptive",
              upstream_reported_reasoning_effort: "xhigh",
              upstream_transport: "ws",
            },
            citations: [source],
            hosted_tools: [{ name: "web_search", status: "completed", action: { sources: [source] } }],
          },
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        },
        "[DONE]",
      );
    };

    const result = await runGatewayAnalysis({ ...options, fetchImpl });

    expect(result.text).toBe("확인 결과");
    expect(result.sources).toEqual([source]);
    expect(result.searched).toBe(true);
    expect(result.upstreamResponseId).toBe("resp_123");
    expect(result.upstreamReportedModel).toBe("gpt-6-astra-2026-09-15");
    expect(result.upstreamReportedReasoningMode).toBe("adaptive");
    expect(result.upstreamReportedReasoningEffort).toBe("xhigh");
    expect(result.safeDiagnostics).toMatchObject({ terminalStatus: "completed", upstreamResponseId: "resp_123", upstreamTransport: "ws" });
    const body = JSON.parse(sentBody);
    expect(body.model).toBe("gpt-6-astra");
    expect(body.reasoning_effort).toBe("xhigh");
    expect(body.llms.web_search.mode).toBe("live");
    expect(body.tool_choice).toBe("required");
  });

  it("does not accept an incomplete upstream response as a finished analysis", async () => {
    const fetchImpl = vi.fn(async () =>
      sse({ choices: [{ delta: { content: "부분 결과" } }] }, {
        llms: { terminal: { status: "incomplete" }, citations: [source] },
      }, "[DONE]"),
    );
    await expect(runGatewayAnalysis({ ...options, fetchImpl })).rejects.toMatchObject({
      code: "upstream_incomplete",
    });
  });

  it("rejects EOF without a terminal event", async () => {
    const fetchImpl = vi.fn(async () => sse({ choices: [{ delta: { content: "부분 결과" } }] }));
    await expect(runGatewayAnalysis({ ...options, fetchImpl })).rejects.toMatchObject({
      code: "upstream_interrupted",
      safeDiagnostics: { terminalStatus: "interrupted", upstreamErrorCode: "upstream_eof" },
    });
  });

  it("keeps a safe interruption cause and response ID from an interrupted terminal event", async () => {
    const fetchImpl = vi.fn(async () => sse({
      llms: { terminal: {
        status: "interrupted", error: { code: "upstream_timeout", message: "private detail" }, upstream_response_id: "resp-partial",
        transport_error_kind: "connection_reset", request_context_cancelled: true, upstream_elapsed_ms: 900_001,
        last_event_age_ms: 7, event_count: 14, upstream_http_protocol: "HTTP/2.0", request_id: "req_A1-b2",
        user_context: "private context",
      } },
    }));
    await expect(runGatewayAnalysis({ ...options, fetchImpl })).rejects.toMatchObject({
      code: "upstream_interrupted",
      safeDiagnostics: {
        terminalStatus: "interrupted", upstreamErrorCode: "upstream_timeout", upstreamResponseId: "resp-partial",
        transportErrorKind: "connection_reset", requestContextCancelled: true, upstreamElapsedMs: 900_001,
        lastEventAgeMs: 7, eventCount: 14, upstreamHttpProtocol: "HTTP/2.0", requestId: "req_A1-b2",
      },
    });
  });

  it.each(["http", "ws"] as const)("preserves allowlisted upstream transport %s", async (upstream_transport) => {
    const fetchImpl = vi.fn(async () => sse({ llms: { terminal: {
      status: "interrupted", error: { code: "upstream_transport_error" }, upstream_transport,
    } } }));
    await expect(runGatewayAnalysis({ ...options, fetchImpl })).rejects.toMatchObject({
      code: "upstream_interrupted",
      safeDiagnostics: { terminalStatus: "interrupted", upstreamTransport: upstream_transport },
    });
  });

  it("preserves bounded WebSocket close, read-limit, and event diagnostics", async () => {
    const fetchImpl = vi.fn(async () => sse({ llms: { terminal: {
      status: "interrupted", error: { code: "upstream_eof" }, websocket_close_code: 1001,
      websocket_message_too_big: true, websocket_protocol_error: true,
      last_event_type: "response.web_search_call.searching",
    } } }));
    await expect(runGatewayAnalysis({ ...options, fetchImpl })).rejects.toMatchObject({
      code: "upstream_interrupted",
      safeDiagnostics: {
        terminalStatus: "interrupted", upstreamErrorCode: "upstream_eof", websocketCloseCode: 1001,
        websocketMessageTooBig: true, websocketProtocolError: true, lastEventType: "response.web_search_call.searching",
      },
    });
  });

  it("drops invalid WebSocket codes, event types, and read-limit flags", async () => {
    const fetchImpl = vi.fn(async () => sse({ llms: { terminal: {
      status: "interrupted", error: { code: "upstream_transport_error" }, websocket_close_code: 10000,
      websocket_message_too_big: "true", websocket_protocol_error: "true", last_event_type: "private upstream payload",
    } } }));
    let caught: unknown;
    await runGatewayAnalysis({ ...options, fetchImpl }).catch((error) => { caught = error; });
    expect((caught as { safeDiagnostics: unknown }).safeDiagnostics).toEqual({
      terminalStatus: "interrupted", upstreamErrorCode: "upstream_transport_error", diagnostics: { gateway_http_status: 200 },
    });
    expect((caught as Error).message).not.toContain("private upstream payload");
  });

  it("drops an unknown upstream transport value", async () => {
    const fetchImpl = vi.fn(async () => sse({ llms: { terminal: {
      status: "interrupted", error: { code: "upstream_transport_error" }, upstream_transport: "private-transport-detail",
    } } }));
    let caught: unknown;
    await runGatewayAnalysis({ ...options, fetchImpl }).catch((error) => { caught = error; });
    expect((caught as { safeDiagnostics: unknown }).safeDiagnostics).toEqual({
      terminalStatus: "interrupted", upstreamErrorCode: "upstream_transport_error", diagnostics: { gateway_http_status: 200 },
    });
    expect((caught as Error).message).not.toContain("private-transport-detail");
  });

  it("drops unknown or out-of-bounds structured upstream diagnostics", async () => {
    const fetchImpl = vi.fn(async () => sse({ llms: { terminal: {
      status: "interrupted", transport_error_kind: "credential_dump", request_context_cancelled: "yes",
      upstream_elapsed_ms: -1, last_event_age_ms: 86_400_001, event_count: 1_000_001,
      upstream_http_protocol: "HTTP/3", request_id: "réq-secret", user_context: "private context",
    } } }));
    let caught: unknown;
    await runGatewayAnalysis({ ...options, fetchImpl }).catch((error) => { caught = error; });
    expect((caught as { safeDiagnostics: unknown }).safeDiagnostics).toEqual({ terminalStatus: "interrupted", upstreamErrorCode: "upstream_eof", diagnostics: { gateway_http_status: 200 } });
    expect((caught as Error).message).not.toContain("private context");
  });

  it("preserves allowlisted provider errors from failed terminal events without raw details", async () => {
    const fetchImpl = vi.fn(async () => sse({ llms: { terminal: {
      status: "failed", error: { code: "server_error", message: "private request details" }, upstream_response_id: "resp-failed",
    } } }));
    await expect(runGatewayAnalysis({ ...options, fetchImpl })).rejects.toMatchObject({
      code: "upstream_failed",
      message: "Upstream returned a terminal error",
      safeDiagnostics: { terminalStatus: "failed", upstreamErrorCode: "server_error", upstreamResponseId: "resp-failed" },
    });
  });

  it("retains already received diagnostics when the SSE transport errors", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ llms: { terminal: { status: "interrupted", error: { code: "upstream_transport_error" }, upstream_response_id: "resp-transport" } } })}\n\n`));
        setTimeout(() => controller.error(new Error("private socket text")), 0);
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }));
    let caught: unknown;
    await runGatewayAnalysis({ ...options, fetchImpl }).catch((error) => { caught = error; });
    expect(caught).toMatchObject({
      code: "upstream_interrupted",
      safeDiagnostics: { terminalStatus: "interrupted", upstreamErrorCode: "upstream_transport_error", upstreamResponseId: "resp-transport" },
    });
    expect((caught as Error).message).not.toContain("private socket text");
  });

  it("accepts a completed verified terminal event even if the stream later closes with an error", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
          llms: { terminal: { status: "completed", upstream_response_id: "resp-complete" }, citations: [source], hosted_tools: [{ name: "web_search", status: "completed" }] },
          choices: [{ delta: { content: "완료된 응답" } }],
        })}\n\n`));
        setTimeout(() => controller.error(new Error("late socket error")), 0);
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }));
    await expect(runGatewayAnalysis({ ...options, fetchImpl })).resolves.toMatchObject({
      text: "완료된 응답", verified: true, upstreamResponseId: "resp-complete", sources: [source],
    });
  });

  it("returns at a completed terminal event when the upstream stream stays open", async () => {
    const terminalFrame = `data: ${JSON.stringify({ llms: { terminal: { status: "completed", upstream_response_id: "resp-open" }, citations: [source], hosted_tools: [{ name: "web_search", status: "completed" }] }, choices: [{ delta: { content: "완료" } }] })}\n\n`;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(terminalFrame)); },
      cancel() { cancelled = true; },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }));
    await expect(runGatewayAnalysis({ ...options, fetchImpl })).resolves.toMatchObject({ verified: true, upstreamResponseId: "resp-open" });
    expect(cancelled).toBe(true);
  });

  it("classifies nested Undici timeout causes as upstream timeouts", async () => {
    const timeoutError = Object.assign(new Error("private undici detail"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } });
    const fetchImpl = vi.fn(async () => { throw timeoutError; });
    await expect(runGatewayAnalysis({ ...options, fetchImpl })).rejects.toMatchObject({
      code: "upstream_interrupted", safeDiagnostics: { terminalStatus: "interrupted", upstreamErrorCode: "upstream_timeout" },
    });
  });

  it("uses configured timeout values for the actual Undici dispatcher", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({ llms: { terminal: { status: "completed" } } })}\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected an ephemeral HTTP port");
    let received: { headersTimeout: number; bodyTimeout: number } | undefined;
    const fetchImpl: typeof fetch = (input, init) => {
      const dispatcher = (init as RequestInit & { dispatcher?: Agent }).dispatcher;
      received = dispatcher && Reflect.ownKeys(dispatcher)
        .map((key) => (dispatcher as unknown as Record<PropertyKey, unknown>)[key])
        .find((value): value is { headersTimeout: number; bodyTimeout: number } => Boolean(value && typeof value === "object" && "headersTimeout" in value && "bodyTimeout" in value));
      return (undiciFetch as unknown as typeof fetch)(input, init);
    };
    try {
      await runGatewayAnalysis({ ...options, baseUrl: `http://127.0.0.1:${address.port}/r/sports/v1`, timeoutMs: 2_760_000, fetchImpl });
      expect(received).toMatchObject({ headersTimeout: 2_760_000, bodyTimeout: 2_760_000 });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("preserves an explicit quota error code from the gateway", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "quota_exhausted" }), { status: 503 }));
    await expect(runGatewayAnalysis({ ...options, fetchImpl })).rejects.toMatchObject({
      code: "quota_exhausted",
      status: 503,
    });
  });

  it("does not expose provider error text or unknown error codes", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: "failed for user@example.com", message: "private response text" } }), { status: 503 }));
    let caught: unknown;
    await runGatewayAnalysis({ ...options, fetchImpl }).catch((error) => { caught = error; });
    expect(caught).toMatchObject({ code: "gateway_http_error", status: 503 });
    expect((caught as Error).message).not.toContain("user@example.com");
    expect((caught as Error).message).not.toContain("private response text");
  });

  it("marks a completed answer without a cited URL as unverified", async () => {
    const fetchImpl = vi.fn(async () =>
      sse({
        choices: [{ delta: { content: "출처 없음" } }],
        llms: { terminal: { status: "completed" }, hosted_tools: [{ name: "web_search", status: "completed" }] },
      }, "[DONE]"),
    );
    const result = await runGatewayAnalysis({ ...options, fetchImpl });
    expect(result.searched).toBe(true);
    expect(result.sources).toEqual([]);
    expect(result.verified).toBe(false);
  });

  it("reports missing upstream model metadata as null and ignores requested chunk models", async () => {
    const fetchImpl = vi.fn(async () => sse(
      { model: "gpt-6-astra", choices: [{ delta: { content: "응답" } }] },
      { llms: { terminal: { status: "completed" } } },
      "[DONE]",
    ));

    const result = await runGatewayAnalysis({ ...options, fetchImpl });

    expect(result.upstreamReportedModel).toBeNull();
    expect(result.upstreamReportedReasoningMode).toBeNull();
    expect(result.upstreamReportedReasoningEffort).toBeNull();
  });

  it("ignores empty and oversized upstream metadata strings", async () => {
    const fetchImpl = vi.fn(async () => sse({
      llms: {
        terminal: {
          status: "completed",
          upstream_reported_model: " ",
          upstream_reported_reasoning_mode: "m".repeat(129),
          upstream_reported_reasoning_effort: "xhigh",
        },
      },
    }, "[DONE]"));

    const result = await runGatewayAnalysis({ ...options, fetchImpl });

    expect(result.upstreamReportedModel).toBeNull();
    expect(result.upstreamReportedReasoningMode).toBeNull();
    expect(result.upstreamReportedReasoningEffort).toBe("xhigh");
  });
});

it.each(["auto", "required"] as const)("sends the selected search policy %s without changing honest completion flags",async toolChoice => {
 let body:Record<string,unknown> = {};
 const fetchImpl:typeof fetch = async (_input,init) => {body=JSON.parse(String(init?.body));return sse({choices:[{delta:{content:"대화 응답"}}],llms:{terminal:{status:"completed"}}},"[DONE]");};
 const result=await runGatewayAnalysis({...options,toolChoice,fetchImpl});
 expect(body.tool_choice).toBe(toolChoice); expect(result.text).toBe("대화 응답"); expect(result.searched).toBe(false); expect(result.verified).toBe(false);
});

it("aborts a live gateway stream through the worker signal without replaying the POST", async () => {
  let received!: () => void;
  const started = new Promise<void>(resolve => { received = resolve; });
  let posts = 0;
  const server = createServer((_request, response) => {
    posts++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`);
    received();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected an ephemeral HTTP port");
  const controller = new AbortController();
  const dispatcher = new Agent({ headersTimeout: 1000, bodyTimeout: 1000 });
  try {
    const pending = runGatewayAnalysis({ ...options, baseUrl: `http://127.0.0.1:${address.port}`, signal: controller.signal, dispatcherFactory: () => dispatcher });
    const rejected = expect(pending).rejects.toMatchObject({ code: "upstream_interrupted" });
    await started;
    controller.abort();
    await rejected;
    expect(posts).toBe(1);
  } finally {
    await dispatcher.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it("records actual HTTP correlation and read-stage causes without raw errors", async () => {
  const requestId = "44444444-4444-4444-4444-444444444444";
  const gatewayId = "55555555-5555-5555-5555-555555555555";
  let requestHeaders: Headers | undefined;
  const fetchImpl: typeof fetch = async (_url, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response(new ReadableStream({ start(controller) { controller.error(Object.assign(new Error("CANARY TOKEN prompt rawstack"), { cause: { code: "ECONNRESET", message: "CANARY" } })); } }), { headers: { "content-type": "text/event-stream", "X-SportsDesk-Gateway-Request-Id": gatewayId } });
  };
  let caught: unknown;
  try { await runGatewayAnalysis({ ...options, fetchImpl, correlation: { jobId: "11111111-1111-1111-1111-111111111111", attemptId: "22222222-2222-2222-2222-222222222222", transportAttempt: 1, requestId } }); } catch (error) { caught = error; }
  expect(requestHeaders?.get("X-SportsDesk-Request-Id")).toBe(requestId);
  expect(caught).toMatchObject({ safeDiagnostics: { diagnostics: { gateway_http_status: 200, gateway_request_id: gatewayId, stage: "worker_gateway_read", error_origin: "worker_gateway", root_cause: "connection_reset" } } });
  expect(JSON.stringify(caught)).not.toMatch(/CANARY|TOKEN|prompt|rawstack/);
});

it("preserves a validated upstream subset while rejecting worker identity injection", async () => {
  const fetchImpl: typeof fetch = async () => sse({ llms: { terminal: { status: "interrupted", error: { code: "upstream_transport_error" }, diagnostics: { schema_version: 1, stage: "upstream_dial", error_origin: "gateway_upstream", root_cause: "dns_error", upstream_http_status: 503, cause_chain: [{ type: "dns", code: "ENOTFOUND" }] } } } });
  await expect(runGatewayAnalysis({ ...options, fetchImpl })).rejects.toMatchObject({ safeDiagnostics: { diagnostics: { gateway_http_status: 200, stage: "upstream_dial", upstream_http_status: 503, root_cause: "dns_error" } } });
});

it("drops an entire malicious terminal subset and untrusted gateway header while retaining actual HTTP status", async () => {
  const body = { llms: { terminal: { status: "interrupted", diagnostics: { schema_version: 1, request_id: "11111111-1111-1111-1111-111111111111", started_at: "2026-10-20T00:00:00.000Z", root_cause: "TOKEN prompt", cause_chain: [{ type: "unknown", stack: "CANARY rawstack" }] } } } };
  const fetchImpl: typeof fetch = async () => new Response(`data: ${JSON.stringify(body)}\n\n`, { headers: { "content-type": "text/event-stream", "X-SportsDesk-Gateway-Request-Id": "TOKEN-private-header" } });
  let caught: unknown;
  try { await runGatewayAnalysis({ ...options, fetchImpl }); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ safeDiagnostics: { diagnostics: { gateway_http_status: 200 } } });
  expect(JSON.stringify(caught)).not.toMatch(/TOKEN|CANARY|prompt|rawstack|started_at/);
});

it("distinguishes rejected gateway HTTP from an upstream HTTP terminal", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ error: { code: "invalid_api_key", message: "TOKEN CANARY" } }), { status: 401, headers: { "X-SportsDesk-Gateway-Request-Id": "55555555-5555-5555-5555-555555555555" } });
  await expect(runGatewayAnalysis({ ...options, fetchImpl })).rejects.toMatchObject({ code: "invalid_api_key", safeDiagnostics: { diagnostics: { gateway_http_status: 401, gateway_request_id: "55555555-5555-5555-5555-555555555555", stage: "worker_gateway_fetch", root_cause: "http_rejected" } } });
});

it("records a handshake failure separately from a failed gateway error-body read", async () => {
  const cause = Object.assign(new Error("CANARY host token"), { code: "ENOTFOUND" });
  await expect(runGatewayAnalysis({ ...options, fetchImpl: async () => { throw Object.assign(new Error("private"), { cause }); } })).rejects.toMatchObject({ safeDiagnostics: { diagnostics: { stage: "worker_gateway_fetch", root_cause: "dns_error", cause_chain: [{ type: "unknown" }, { type: "dns", code: "ENOTFOUND" }] } } });
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream({ start(controller) { controller.error(Object.assign(new Error("CANARY"), { code: "ECONNRESET" })); } }), { status: 502 });
  await expect(runGatewayAnalysis({ ...options, fetchImpl })).rejects.toMatchObject({ safeDiagnostics: { diagnostics: { gateway_http_status: 502, stage: "worker_gateway_read", root_cause: "connection_reset" } } });
});

const recoveryAccount = "66666666-6666-6666-6666-666666666666";
const recoveryCorrelation = { jobId: "11111111-1111-1111-1111-111111111111", attemptId: "22222222-2222-2222-2222-222222222222", transportAttempt: 2 as const, requestId: "44444444-4444-4444-4444-444444444444" };
it("retains the selected account only as an ephemeral interruption hint across read-error wrapping", async () => {
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream({ start(c) { c.error(Object.assign(new Error("private"), { code: "ECONNRESET" })); } }), { headers: { "content-type": "text/event-stream", "X-LLMs-Account-Id": recoveryAccount } });
  let caught: unknown;
  try { await runGatewayAnalysis({ ...options, fetchImpl }); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ recoveryAccountId: recoveryAccount });
  expect(JSON.stringify(caught)).not.toContain(recoveryAccount);
  expect(JSON.stringify((caught as { safeDiagnostics: unknown }).safeDiagnostics)).not.toContain(recoveryAccount);
});
it("emits the HTTP recovery selector only on the correlated second request and keeps it out of the model body", async () => {
  let headers: Headers | undefined; let body = "";
  const fetchImpl: typeof fetch = async (_url, init) => { headers = new Headers(init?.headers); body = String(init?.body); return sse({ llms: { terminal: { status: "completed" } } }); };
  await runGatewayAnalysis({ ...options, fetchImpl, correlation: recoveryCorrelation, transportRecovery: { transport: "http", accountId: recoveryAccount } });
  expect(headers?.get("X-SportsDesk-Upstream-Transport")).toBe("http");
  expect(headers?.get("X-SportsDesk-Recovery-Account-Id")).toBe(recoveryAccount);
  expect(body).not.toContain(recoveryAccount); expect(body).not.toContain("transportRecovery");
});
it.each([undefined, { ...recoveryCorrelation, transportAttempt: 1 }, { ...recoveryCorrelation, jobId: "invalid" }])("rejects an unbound recovery selector before fetch (%j)", async correlation => {
  const fetchImpl = vi.fn();
  await expect(runGatewayAnalysis({ ...options, fetchImpl, correlation: correlation as typeof recoveryCorrelation, transportRecovery: { transport: "http", accountId: recoveryAccount } })).rejects.toMatchObject({ code: "invalid_transport_recovery" });
  expect(fetchImpl).not.toHaveBeenCalled();
});

it.each(["invalid", "Bearer-private-token", "00000000-0000-0000-0000-000000000000"])("rejects an invalid account selector before any request (%s)", async accountId => {
  const fetchImpl = vi.fn();
  await expect(runGatewayAnalysis({ ...options, fetchImpl, correlation: recoveryCorrelation, transportRecovery: { transport: "http", accountId } })).rejects.toMatchObject({ code: "invalid_transport_recovery" });
  expect(fetchImpl).not.toHaveBeenCalled();
});
it.each(["Bearer-private-token", "00000000-0000-0000-0000-000000000000"])("does not expose an invalid selected-account response header as a recovery hint (%s)", async hint => {
  const fetchImpl: typeof fetch = async () => new Response(`data: ${JSON.stringify({ llms: { terminal: { status: "interrupted", error: { code: "upstream_transport_error" }, upstream_transport: "ws", transport_error_kind: "unexpected_eof" } } })}\n\n`, { headers: { "content-type": "text/event-stream", "X-LLMs-Account-Id": hint } });
  let caught: unknown;
  try { await runGatewayAnalysis({ ...options, fetchImpl }); } catch (error) { caught = error; }
  expect(caught).not.toHaveProperty("recoveryAccountId"); expect(JSON.stringify(caught)).not.toContain("Bearer-private-token");
});

it.each([
  [undefined, false, 0, 0],
  [{ prompt_tokens: 0, completion_tokens: 0 }, true, 0, 0],
  [{ prompt_tokens: 123, completion_tokens: 45 }, true, 123, 45],
  [{ prompt_tokens: 123 }, false, 123, 0],
  [{ prompt_tokens: -1, completion_tokens: 4 }, false, 0, 4],
])("distinguishes missing or invalid provider usage from observed zero (%j)", async (usage, available, inputTokens, outputTokens) => {
  const result = await runGatewayAnalysis({ ...options, fetchImpl: async () => sse({ choices: [{ delta: { content: "done" } }], usage, llms: { terminal: { status: "completed" } } }) });
  expect(result).toMatchObject({ usageAvailable: available, usage: { inputTokens, outputTokens } });
});
