import { classifyTransportCause, isUUID, validateGatewayDiagnostics, type SafeTransportDetails } from "./diagnostics";
import { Agent, fetch as undiciFetch } from "undici";
import { DEFAULT_UPSTREAM_TIMEOUT_SECONDS, workerTransportTimeoutMs } from "./timeout";

export type GatewaySource = { title: string; url: string };

export type GatewayResult = {
  text: string;
  sources: GatewaySource[];
  searched: boolean;
  verified: boolean;
  upstreamResponseId: string | null;
  upstreamReportedModel?: string | null;
  upstreamReportedReasoningMode?: string | null;
  upstreamReportedReasoningEffort?: string | null;
  safeDiagnostics?: GatewaySafeDiagnostics;
  usage: { inputTokens: number; outputTokens: number };
  usageAvailable?: boolean;
};

export type GatewaySafeEventType =
  | "response.created" | "response.in_progress" | "response.completed" | "response.incomplete"
  | "response.failed" | "response.cancelled" | "response.output_item.added" | "response.output_item.done"
  | "response.output_text.delta" | "response.output_text.done" | "response.content_part.added" | "response.content_part.done"
  | "response.refusal.delta" | "response.refusal.done" | "response.function_call_arguments.delta"
  | "response.function_call_arguments.done" | "response.reasoning_summary_text.delta"
  | "response.reasoning_summary_text.done" | "response.web_search_call.in_progress"
  | "response.web_search_call.searching" | "response.web_search_call.completed" | "error" | "other";

export type GatewayOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  effort: "medium" | "high" | "xhigh";
  context: string;
  instructions: string;
  toolChoice?: "auto" | "required";
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  correlation?: { jobId: string; attemptId: string; transportAttempt: 1 | 2; requestId: string };
  transportRecovery?: { transport: "http"; accountId: string };
  dispatcherFactory?: (timeoutMs: number) => Agent;
};

export type GatewaySafeDiagnostics = {
  diagnostics?: SafeTransportDetails;
  terminalStatus?: "completed" | "incomplete" | "failed" | "cancelled" | "interrupted";
  upstreamErrorCode?: string;
  upstreamResponseId?: string | null;
  httpStatus?: number;
  transportErrorKind?: "deadline_exceeded" | "context_cancelled" | "unexpected_eof" | "connection_reset" | "connection_closed" | "scanner_token_too_long" | "unknown_transport_error";
  requestContextCancelled?: boolean;
  upstreamElapsedMs?: number;
  lastEventAgeMs?: number;
  eventCount?: number;
  upstreamHttpProtocol?: "HTTP/1.1" | "HTTP/2.0";
  requestId?: string;
  upstreamTransport?: "http" | "ws";
  websocketCloseCode?: number;
  websocketMessageTooBig?: boolean;
  websocketProtocolError?: boolean;
  lastEventType?: GatewaySafeEventType;
};

const validRecoveryAccount = (value: unknown): value is string => isUUID(value) && value !== "00000000-0000-0000-0000-000000000000";

export class GatewayError extends Error {
  declare readonly recoveryAccountId?: string;
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly safeDiagnostics?: GatewaySafeDiagnostics,
    recoveryAccountId?: string,
  ) {
    super(message);
    this.name = "GatewayError";
    if (validRecoveryAccount(recoveryAccountId)) Object.defineProperty(this, "recoveryAccountId", { value: recoveryAccountId, enumerable: false });
  }
}

const dispatchers = new Map<number, Agent>();
function dispatcherFor(timeoutMs: number, factory?: GatewayOptions["dispatcherFactory"]): Agent {
  if (factory) return factory(timeoutMs);
  const cached = dispatchers.get(timeoutMs);
  if (cached) return cached;
  const dispatcher = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
  dispatchers.set(timeoutMs, dispatcher);
  return dispatcher;
}

function validSource(value: unknown): GatewaySource | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.url !== "string") return null;
  try {
    const url = new URL(item.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { title: String(item.title || url.hostname), url: url.href };
  } catch {
    return null;
  }
}

function sourceValues(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function boundedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 128 ? normalized : null;
}

const terminalStatuses = new Set(["completed", "incomplete", "failed", "cancelled", "interrupted"]);
const safeUpstreamErrorCodes = new Set([
  "upstream_timeout", "upstream_transport_error", "upstream_eof", "max_output_tokens", "content_filter",
  "server_error", "rate_limit_exceeded", "invalid_prompt", "cancelled", "upstream_error",
  "insufficient_quota", "quota_exhausted", "billing_hard_limit_reached", "usage_limit_reached",
  "gateway_unauthorized", "invalid_api_key", "token_expired", "authentication_required",
]);
const safeTransportErrorKinds = new Set([
  "deadline_exceeded", "context_cancelled", "unexpected_eof", "connection_reset", "connection_closed",
  "scanner_token_too_long", "unknown_transport_error",
]);
const safeUpstreamEventTypes = new Set<GatewaySafeEventType>([
  "response.created", "response.in_progress", "response.completed", "response.incomplete", "response.failed", "response.cancelled",
  "response.output_item.added", "response.output_item.done", "response.output_text.delta", "response.output_text.done",
  "response.content_part.added", "response.content_part.done", "response.refusal.delta", "response.refusal.done",
  "response.function_call_arguments.delta", "response.function_call_arguments.done",
  "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done",
  "response.web_search_call.in_progress", "response.web_search_call.searching", "response.web_search_call.completed", "error", "other",
]);
const safeHttpErrorCodes = new Set([
  "insufficient_quota", "quota_exhausted", "billing_hard_limit_reached", "usage_limit_reached",
  "gateway_unauthorized", "invalid_api_key", "token_expired", "authentication_required",
  "gateway_rate_limited", "gateway_http_error",
]);
function terminalDiagnostics(terminal: Record<string, unknown> | null): GatewaySafeDiagnostics {
  const status = terminal?.status;
  const diagnostics: GatewaySafeDiagnostics = {
    terminalStatus: typeof status === "string" && terminalStatuses.has(status) ? status as GatewaySafeDiagnostics["terminalStatus"] : "interrupted",
  };
  if (validateGatewayDiagnostics(terminal?.diagnostics)) {
    diagnostics.diagnostics = Object.fromEntries(Object.entries(terminal.diagnostics).filter(([key]) => key !== "schema_version" && key !== "elapsed_ms"));
  }
  const error = terminal?.error && typeof terminal.error === "object" ? terminal.error as Record<string, unknown> : null;
  if (typeof error?.code === "string" && safeUpstreamErrorCodes.has(error.code)) diagnostics.upstreamErrorCode = error.code;
  if (typeof terminal?.upstream_response_id === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(terminal.upstream_response_id))
    diagnostics.upstreamResponseId = terminal.upstream_response_id;
  if (typeof terminal?.transport_error_kind === "string" && safeTransportErrorKinds.has(terminal.transport_error_kind))
    diagnostics.transportErrorKind = terminal.transport_error_kind as GatewaySafeDiagnostics["transportErrorKind"];
  if (typeof terminal?.request_context_cancelled === "boolean") diagnostics.requestContextCancelled = terminal.request_context_cancelled;
  const upstreamElapsedMs = terminal?.upstream_elapsed_ms;
  if (typeof upstreamElapsedMs === "number" && Number.isInteger(upstreamElapsedMs) && upstreamElapsedMs >= 0 && upstreamElapsedMs <= 86_400_000)
    diagnostics.upstreamElapsedMs = upstreamElapsedMs;
  const lastEventAgeMs = terminal?.last_event_age_ms;
  if (typeof lastEventAgeMs === "number" && Number.isInteger(lastEventAgeMs) && lastEventAgeMs >= 0 && lastEventAgeMs <= 86_400_000)
    diagnostics.lastEventAgeMs = lastEventAgeMs;
  const eventCount = terminal?.event_count;
  if (typeof eventCount === "number" && Number.isInteger(eventCount) && eventCount >= 0 && eventCount <= 1_000_000)
    diagnostics.eventCount = eventCount;
  if (terminal?.upstream_http_protocol === "HTTP/1.1" || terminal?.upstream_http_protocol === "HTTP/2.0")
    diagnostics.upstreamHttpProtocol = terminal.upstream_http_protocol;
  if (terminal?.upstream_transport === "http" || terminal?.upstream_transport === "ws")
    diagnostics.upstreamTransport = terminal.upstream_transport;
  const websocketCloseCode = terminal?.websocket_close_code;
  if (typeof websocketCloseCode === "number" && Number.isInteger(websocketCloseCode) && websocketCloseCode >= 1000 && websocketCloseCode <= 4999)
    diagnostics.websocketCloseCode = websocketCloseCode;
  if (typeof terminal?.websocket_message_too_big === "boolean") diagnostics.websocketMessageTooBig = terminal.websocket_message_too_big;
  if (typeof terminal?.websocket_protocol_error === "boolean") diagnostics.websocketProtocolError = terminal.websocket_protocol_error;
  if (typeof terminal?.last_event_type === "string" && safeUpstreamEventTypes.has(terminal.last_event_type as GatewaySafeEventType))
    diagnostics.lastEventType = terminal.last_event_type as GatewaySafeEventType;
  if (typeof terminal?.request_id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(terminal.request_id))
    diagnostics.requestId = terminal.request_id;
  return diagnostics;
}

function interruptionError(terminal: Record<string, unknown> | null, defaultCode: string): GatewayError {
  const diagnostics = terminalDiagnostics(terminal);
  if (!diagnostics.upstreamErrorCode) diagnostics.upstreamErrorCode = defaultCode;
  return new GatewayError("upstream_interrupted", "Upstream response was interrupted before completion", undefined, diagnostics);
}

function transportErrorCode(error: unknown): string {
  const direct = (error as { code?: unknown } | null)?.code;
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return direct === "UND_ERR_HEADERS_TIMEOUT" || direct === "UND_ERR_BODY_TIMEOUT" || cause === "UND_ERR_HEADERS_TIMEOUT" || cause === "UND_ERR_BODY_TIMEOUT"
    ? "upstream_timeout"
    : "upstream_transport_error";
}

export async function runGatewayAnalysis(options: GatewayOptions): Promise<GatewayResult> {
  const endpoint = new URL(options.baseUrl.replace(/\/$/, "") + "/chat/completions");
  // Keep fetch and its dispatcher on the same Undici version across Node runtimes.
  const fetchImpl = options.fetchImpl || (undiciFetch as unknown as typeof fetch);
  const timeoutMs = options.timeoutMs ?? workerTransportTimeoutMs(DEFAULT_UPSTREAM_TIMEOUT_SECONDS);
  const dispatcher = dispatcherFor(timeoutMs, options.dispatcherFactory);
  const correlation = options.correlation;
  const recovery = options.transportRecovery;
  const validCorrelation = correlation && isUUID(correlation.jobId) && isUUID(correlation.attemptId) && isUUID(correlation.requestId) && [1, 2].includes(correlation.transportAttempt);
  if (recovery && (recovery.transport !== "http" || !validRecoveryAccount(recovery.accountId) || !validCorrelation || correlation.transportAttempt !== 2))
    throw new GatewayError("invalid_transport_recovery", "Invalid transport recovery request");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream",
  };
  if (validCorrelation) {
    headers["X-SportsDesk-Job-Id"] = correlation.jobId;
    headers["X-SportsDesk-Attempt-Id"] = correlation.attemptId;
    headers["X-SportsDesk-Transport-Attempt"] = String(correlation.transportAttempt);
    headers["X-SportsDesk-Request-Id"] = correlation.requestId;
  }
  if (recovery) { headers["X-SportsDesk-Upstream-Transport"] = "http"; headers["X-SportsDesk-Recovery-Account-Id"] = recovery.accountId; }
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
      model: options.model,
      reasoning_effort: options.effort,
      stream: true,
      messages: [
        { role: "system", content: options.instructions },
        { role: "user", content: options.context },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Search current public sources for the requested sports facts.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        },
      ],
      tool_choice: options.toolChoice || "required",
      llms: { web_search: { mode: "live" } },
      }),
      dispatcher,
      signal: options.signal,
    } as RequestInit & { dispatcher: Agent });
  } catch (error) {
    throw new GatewayError("upstream_interrupted", "Upstream request was interrupted before completion", undefined, {
      terminalStatus: "interrupted", upstreamErrorCode: transportErrorCode(error),
      diagnostics: { stage: "worker_gateway_fetch", error_origin: "worker_gateway", ...classifyTransportCause(error) },
    });
  }
  const selectedAccount = response.headers.get("X-LLMs-Account-Id");
  const recoveryHint = validRecoveryAccount(selectedAccount) ? selectedAccount : undefined;
  const headerId = response.headers.get("X-SportsDesk-Gateway-Request-Id");
  const httpDiagnostics: SafeTransportDetails = { gateway_http_status: response.status, ...(isUUID(headerId) ? { gateway_request_id: headerId } : {}) };
  const enrich = (error: GatewayError, details?: SafeTransportDetails) => new GatewayError(error.code, error.message, error.status, {
    ...error.safeDiagnostics, diagnostics: { ...error.safeDiagnostics?.diagnostics, ...httpDiagnostics, ...details },
  }, recoveryHint);
  const interrupted = (terminal: Record<string, unknown> | null, code: string, error?: unknown) => enrich(interruptionError(terminal, code), error === undefined ? undefined : { stage: "worker_gateway_read", error_origin: "worker_gateway", ...classifyTransportCause(error) });
  if (!response.ok) {
    let body: string;
    try { body = await response.text(); } catch (error) { throw interrupted(null, transportErrorCode(error), error); }
    let code = response.status === 401 ? "gateway_unauthorized" : "gateway_http_error";
    if (response.status === 429) code = "gateway_rate_limited";
    try {
      const parsed = JSON.parse(body) as { error?: string | { code?: string; message?: string } };
      if (typeof parsed.error === "string") code = parsed.error;
      else if (parsed.error?.code) code = parsed.error.code;
    } catch {
      /* Plain text errors are allowed. */
    }
    if (!safeHttpErrorCodes.has(code)) code = "gateway_http_error";
    throw new GatewayError(code, `Gateway request failed (${response.status})`, response.status, { httpStatus: response.status, diagnostics: { ...httpDiagnostics, stage: "worker_gateway_fetch", error_origin: "worker_gateway", root_cause: "http_rejected", safe_message_code: "http_rejected" } });
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    throw enrich(new GatewayError("gateway_protocol_error", "Gateway did not return an event stream"), { stage: "worker_gateway_read", error_origin: "worker_gateway", root_cause: "protocol_error", safe_message_code: "protocol_error" });

  let text = "";
  const state: { terminal: Record<string, unknown> | null } = { terminal: null };
  let searched = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let inputUsageObserved = false;
  let outputUsageObserved = false;
  const sources = new Map<string, GatewaySource>();
  const consumeBlock = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      throw enrich(new GatewayError("gateway_protocol_error", "Gateway returned malformed event data"), { stage: "json_decode", error_origin: "worker_gateway", ...classifyTransportCause(new SyntaxError()) });
    }
    const choice = Array.isArray(event.choices) ? event.choices[0] as Record<string, unknown> : null;
    const delta = choice?.delta as Record<string, unknown> | undefined;
    if (typeof delta?.content === "string") text += delta.content;
    const usage = event.usage as Record<string, unknown> | undefined;
    if (typeof usage?.prompt_tokens === "number" && Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens >= 0) { inputTokens = usage.prompt_tokens; inputUsageObserved = true; }
    if (typeof usage?.completion_tokens === "number" && Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens >= 0) { outputTokens = usage.completion_tokens; outputUsageObserved = true; }
    const llms = event.llms as Record<string, unknown> | undefined;
    if (!llms) return;
    if (llms.terminal && typeof llms.terminal === "object")
      state.terminal = llms.terminal as Record<string, unknown>;
    for (const value of sourceValues(llms.citations)) {
      const source = validSource(value);
      if (source) sources.set(source.url, source);
    }
    for (const value of sourceValues(llms.hosted_tools)) {
      if (!value || typeof value !== "object") continue;
      const tool = value as Record<string, unknown>;
      if (tool.name !== "web_search") continue;
      if (tool.status === "completed") searched = true;
      const action = tool.action as Record<string, unknown> | undefined;
      for (const item of sourceValues(action?.sources)) {
        const source = validSource(item);
        if (source) sources.set(source.url, source);
      }
    }
  };
  let pending = "";
  const decoder = new TextDecoder();
  if (!response.body) throw interrupted(state.terminal, "upstream_transport_error");
  const reader = response.body.getReader();
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      throw interrupted(state.terminal, transportErrorCode(error), error);
    }
    pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
    pending = pending.replace(/\r\n/g, "\n");
    const blocks = pending.split("\n\n");
    pending = blocks.pop() || "";
    let terminalSeen = false;
    for (const block of blocks) {
      consumeBlock(block);
      if (terminalStatuses.has(String(state.terminal?.status))) {
        terminalSeen = true;
        break;
      }
    }
    if (terminalSeen) {
      void reader.cancel().catch(() => undefined);
      break;
    }
    if (chunk.done) break;
  }
  if (!terminalStatuses.has(String(state.terminal?.status)) && pending.trim()) consumeBlock(pending);
  const terminal = state.terminal;
  const status = terminal?.status;
  if (status !== "completed") {
    const code = status === "incomplete" ? "upstream_incomplete" :
      status === "failed" ? "upstream_failed" :
        status === "cancelled" ? "upstream_cancelled" : "upstream_interrupted";
    const diagnostic = terminalDiagnostics(terminal);
    const upstreamMessage = terminal?.error && typeof terminal.error === "object" ? terminal.error as Record<string, unknown> : null;
    const safeMessage = typeof upstreamMessage?.message === "string" ? "Upstream returned a terminal error" : `Upstream status: ${status || "missing"}`;
    if (status === "interrupted" || !status) throw interrupted(terminal, "upstream_eof");
    throw enrich(new GatewayError(code, safeMessage, undefined, diagnostic));
  }
  const cited = [...sources.values()];
  return {
    text: text.trim(),
    sources: cited,
    searched,
    verified: searched && cited.length > 0 && text.trim().length > 0,
    upstreamResponseId: typeof terminal?.upstream_response_id === "string" ? terminal.upstream_response_id : null,
    upstreamReportedModel: boundedString(terminal?.upstream_reported_model),
    upstreamReportedReasoningMode: boundedString(terminal?.upstream_reported_reasoning_mode),
    upstreamReportedReasoningEffort: boundedString(terminal?.upstream_reported_reasoning_effort),
    safeDiagnostics: { ...terminalDiagnostics(terminal), diagnostics: { ...terminalDiagnostics(terminal).diagnostics, ...httpDiagnostics } },
    usage: { inputTokens, outputTokens },
    usageAvailable: inputUsageObserved && outputUsageObserved,
  };
}
