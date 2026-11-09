import { createHash, randomUUID } from "node:crypto";

export const ROOT_CAUSES = ["deadline_exceeded", "context_cancelled", "unexpected_eof", "connection_reset", "connection_closed", "connection_refused", "dns_error", "tls_error", "http_rejected", "websocket_close", "message_too_big", "protocol_error", "json_error", "scanner_token_too_long", "unknown"] as const;
export type RootCause = typeof ROOT_CAUSES[number];
export const CAUSE_TYPES = ["eof", "context", "syscall", "net", "dns", "tls", "json", "websocket", "scanner", "undici", "http", "unknown"] as const;
export const CAUSE_CODES = ["ERR_CANCELED", "UND_ERR_RESPONSE_STATUS_CODE", "ABORT_ERR", "HTTP_REJECTED", "WS_CLOSE", "WS_PROTOCOL", "WS_MESSAGE_TOO_BIG", "JSON_SYNTAX", "JSON_TYPE", "SCANNER_TOO_LONG", "DEADLINE_EXCEEDED", "CONTEXT_CANCELED", "UNKNOWN", "usage_limit_reached", "invalid_request_error", "insufficient_quota", "context_length_exceeded", "model_not_found", "EOF", "UNEXPECTED_EOF", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "ECONNABORTED", "ENOTFOUND", "EAI_AGAIN", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_ABORTED", "context_cancelled", "deadline_exceeded", "scanner_token_too_long", "upstream_timeout", "upstream_transport_error", "upstream_eof", "server_error", "rate_limit_exceeded", "invalid_prompt", "cancelled", "upstream_error", "max_output_tokens", "content_filter"] as const;
export const EVENT_TYPES = ["response.created", "response.in_progress", "response.completed", "response.incomplete", "response.failed", "response.cancelled", "response.output_item.added", "response.output_item.done", "response.output_text.delta", "response.output_text.done", "response.content_part.added", "response.content_part.done", "response.refusal.delta", "response.refusal.done", "response.function_call_arguments.delta", "response.function_call_arguments.done", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done", "response.web_search_call.in_progress", "response.web_search_call.searching", "response.web_search_call.completed", "error", "other"] as const;
export type DiagnosticPhase = "transport_started" | "transport_ended" | "retry_planned" | "finished";
export type SafeTransportDetails = Partial<{
  gateway_request_id: string; upstream_request_id: string; upstream_response_id: string; gateway_build_id: string;
  ended_at: string; elapsed_ms: number; last_event_at: string; last_event_age_ms: number; last_heartbeat_at: string;
  heartbeat_outcome: "owned" | "lost" | "check_failed"; gateway_http_status: number; upstream_http_status: number;
  upstream_http_protocol: "HTTP/1.1" | "HTTP/2.0"; upstream_transport: "http" | "ws";
  stage: "worker_gateway_fetch" | "worker_gateway_read" | "upstream_dial" | "upstream_create_write" | "upstream_read" | "json_decode" | "downstream_write" | "worker_control" | "terminal";
  event_count: number; last_event_type: typeof EVENT_TYPES[number]; upstream_terminal_status: "completed" | "incomplete" | "failed" | "cancelled" | "interrupted";
  downstream_delivery_outcome: "completed" | "write_failed" | "cancelled" | "unknown";
  error_origin: "worker_gateway" | "gateway_upstream" | "gateway_downstream" | "worker_control";
  root_cause: RootCause; cause_chain: { type: typeof CAUSE_TYPES[number]; code?: typeof CAUSE_CODES[number] }[];
  error_fingerprint: string; safe_message_code: RootCause; close_frame_received: boolean; websocket_close_code: number;
  close_reason_code: "empty" | "normal_shutdown" | "server_restart" | "overloaded" | "unrecognized";
  websocket_message_too_big: boolean; websocket_protocol_error: boolean;
  cancellation_origin: "worker_deadline" | "gateway_deadline" | "lease_lost" | "downstream_disconnect" | "shutdown" | "unknown";
  retry_decision: "retry" | "stop";
  retry_reason: "eligible_transport" | "attempt_limit" | "excluded_error" | "deadline" | "lease_lost" | "ownership_check_failed" | "cancelled";
}>;
export type TransportDiagnostics = SafeTransportDetails & { transport_attempt: 1 | 2; request_id: string; started_at: string };
export type Diagnostics = { schema_version: 1; sequence: number; job_id: string; attempt_id: string; phase: DiagnosticPhase; updated_at: string; worker_build_id: string; worker_instance_id: string; transports: TransportDiagnostics[] };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const isUUID = (v: unknown): v is string => typeof v === "string" && uuid.test(v);
const build = (v: unknown) => v === "unknown" || isUUID(v) || typeof v === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(v);
export const safeBuildId = (v: unknown): string => build(v) ? String(v) : "unknown";
const utc = (v: unknown) => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const integer = (v: unknown, lo = 0, hi = 2147483647) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const enumeration = (values: readonly string[]) => (v: unknown) => typeof v === "string" && values.includes(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const boundedJSON = (v: unknown) => { try { return Buffer.byteLength(JSON.stringify(v)) <= 16 * 1024; } catch { return false; } };
const detailRules: Record<keyof SafeTransportDetails, (v: unknown) => boolean> = {
  gateway_request_id: isUUID, upstream_request_id: v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v), upstream_response_id: v => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(v), gateway_build_id: build,
  ended_at: utc, elapsed_ms: integer, last_event_at: utc, last_event_age_ms: integer, last_heartbeat_at: utc,
  heartbeat_outcome: enumeration(["owned", "lost", "check_failed"]), gateway_http_status: v => integer(v, 100, 599), upstream_http_status: v => integer(v, 100, 599),
  upstream_http_protocol: enumeration(["HTTP/1.1", "HTTP/2.0"]), upstream_transport: enumeration(["http", "ws"]),
  stage: enumeration(["worker_gateway_fetch", "worker_gateway_read", "upstream_dial", "upstream_create_write", "upstream_read", "json_decode", "downstream_write", "worker_control", "terminal"]),
  event_count: integer, last_event_type: enumeration(EVENT_TYPES), upstream_terminal_status: enumeration(["completed", "incomplete", "failed", "cancelled", "interrupted"]),
  downstream_delivery_outcome: enumeration(["completed", "write_failed", "cancelled", "unknown"]), error_origin: enumeration(["worker_gateway", "gateway_upstream", "gateway_downstream", "worker_control"]),
  root_cause: enumeration(ROOT_CAUSES), safe_message_code: enumeration(ROOT_CAUSES),
  cause_chain: v => Array.isArray(v) && v.length <= 4 && v.every(c => object(c) && Object.keys(c).every(k => k === "type" || k === "code") && enumeration(CAUSE_TYPES)(c.type) && (c.code === undefined || enumeration(CAUSE_CODES)(c.code))),
  error_fingerprint: v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v), close_frame_received: v => typeof v === "boolean", websocket_close_code: v => integer(v, 1000, 4999),
  close_reason_code: enumeration(["empty", "normal_shutdown", "server_restart", "overloaded", "unrecognized"]), websocket_message_too_big: v => typeof v === "boolean", websocket_protocol_error: v => typeof v === "boolean",
  cancellation_origin: enumeration(["worker_deadline", "gateway_deadline", "lease_lost", "downstream_disconnect", "shutdown", "unknown"]), retry_decision: enumeration(["retry", "stop"]),
  retry_reason: enumeration(["eligible_transport", "attempt_limit", "excluded_error", "deadline", "lease_lost", "ownership_check_failed", "cancelled"]),
};
const gatewayForbidden = new Set(["gateway_http_status", "ended_at", "last_heartbeat_at", "heartbeat_outcome", "retry_decision", "retry_reason"]);
export function validateDetails(v: Record<string, unknown>): boolean { return Object.entries(v).every(([k, value]) => Object.hasOwn(detailRules, k) && detailRules[k as keyof SafeTransportDetails](value)); }
export function validateGatewayDiagnostics(v: unknown): v is SafeTransportDetails & { schema_version: 1 } {
  return object(v) && boundedJSON(v) && v.schema_version === 1 && Object.entries(v).every(([k, value]) => k === "schema_version" || !gatewayForbidden.has(k) && Object.hasOwn(detailRules, k) && detailRules[k as keyof SafeTransportDetails](value));
}
export function validateDiagnostics(v: unknown): v is Diagnostics {
  if (!object(v) || !boundedJSON(v)) return false;
  const required = ["schema_version", "sequence", "job_id", "attempt_id", "phase", "updated_at", "worker_build_id", "worker_instance_id", "transports"];
  return Object.keys(v).length === required.length && required.every(k => Object.hasOwn(v, k)) && v.schema_version === 1 && integer(v.sequence, 1, 16) && isUUID(v.job_id) && isUUID(v.attempt_id) && isUUID(v.worker_instance_id) && build(v.worker_build_id) && utc(v.updated_at) && enumeration(["transport_started", "transport_ended", "retry_planned", "finished"])(v.phase) && Array.isArray(v.transports) && v.transports.length <= 2 && v.transports.every((t, i) => {
    if (!object(t) || t.transport_attempt !== i + 1 || !isUUID(t.request_id) || !utc(t.started_at)) return false;
    return validateDetails(Object.fromEntries(Object.entries(t).filter(([key]) => !["transport_attempt", "request_id", "started_at"].includes(key))));
  });
}

// Only own data properties are read; messages, stacks, URLs and arbitrary codes are never fingerprint inputs.
const own = (v: unknown, k: string): unknown => { try { return object(v) ? Object.getOwnPropertyDescriptor(v, k)?.value : undefined; } catch { return undefined; } };
export function classifyTransportCause(error: unknown): Pick<SafeTransportDetails, "root_cause" | "safe_message_code" | "cause_chain" | "error_fingerprint"> {
  const chain: NonNullable<SafeTransportDetails["cause_chain"]> = []; const seen = new Set<unknown>(); let cursor = error; let root: RootCause = "unknown";
  while (object(cursor) && !seen.has(cursor) && chain.length < 4) {
    seen.add(cursor); const rawCode = own(cursor, "code");
    const code = typeof rawCode === "string" && (CAUSE_CODES as readonly string[]).includes(rawCode) ? rawCode as typeof CAUSE_CODES[number] : undefined;
    let type: typeof CAUSE_TYPES[number] = "unknown"; let cause: RootCause = "unknown";
    if (code === "EOF" || code === "UNEXPECTED_EOF" || code === "upstream_eof") { type = "eof"; cause = "unexpected_eof"; }
    else if (code === "ENOTFOUND" || code === "EAI_AGAIN") { type = "dns"; cause = "dns_error"; }
    else if (code && ["ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT"].includes(code)) { type = "tls"; cause = "tls_error"; }
    else if (code?.startsWith("UND_ERR_") && code !== "UND_ERR_RESPONSE_STATUS_CODE") { type = "undici"; cause = code.includes("TIMEOUT") ? "deadline_exceeded" : code === "UND_ERR_ABORTED" ? "context_cancelled" : "connection_closed"; }
    else if (code && ["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "ECONNABORTED"].includes(code)) { type = "syscall"; cause = code === "ECONNRESET" ? "connection_reset" : code === "ECONNREFUSED" ? "connection_refused" : code === "ETIMEDOUT" ? "deadline_exceeded" : "connection_closed"; }
    else if (code === "deadline_exceeded" || code === "upstream_timeout" || code === "context_cancelled" || code === "cancelled") { type = "context"; cause = code === "deadline_exceeded" || code === "upstream_timeout" ? "deadline_exceeded" : "context_cancelled"; }
    else if (code === "scanner_token_too_long") { type = "scanner"; cause = "scanner_token_too_long"; }
    else if (code === "ABORT_ERR" || code === "ERR_CANCELED" || code === "CONTEXT_CANCELED") { type = "context"; cause = "context_cancelled"; }
    else if (code === "DEADLINE_EXCEEDED") { type = "context"; cause = "deadline_exceeded"; }
    else if (code === "HTTP_REJECTED" || code === "UND_ERR_RESPONSE_STATUS_CODE") { type = "http"; cause = "http_rejected"; }
    else if (code === "WS_CLOSE" || code === "WS_PROTOCOL" || code === "WS_MESSAGE_TOO_BIG") { type = "websocket"; cause = code === "WS_CLOSE" ? "websocket_close" : code === "WS_PROTOCOL" ? "protocol_error" : "message_too_big"; }
    else if (code === "SCANNER_TOO_LONG") { type = "scanner"; cause = "scanner_token_too_long"; }
    else if (code === "JSON_SYNTAX" || code === "JSON_TYPE") { type = "json"; cause = "json_error"; }
    else if (cursor instanceof SyntaxError) { type = "json"; cause = "json_error"; }
    chain.push({ type, ...(code ? { code } : {}) }); if (cause !== "unknown") root = cause;
    cursor = own(cursor, "cause");
  }
  const normalized = { root_cause: root, cause_chain: chain };
  return { ...normalized, safe_message_code: root, error_fingerprint: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") };
}

export type DiagnosticEvent = "transport_started" | "transport_ended" | "retry_planned" | "finished" | "checkpoint" | "checkpoint_failed" | "lease_lost" | "cancellation" | "finalize_success" | "finalize_rejected";
export type DiagnosticLogger = (record: Record<string, unknown>) => void;
export class DiagnosticRecorder {
  readonly transports: TransportDiagnostics[] = [];
  private sequence = 0;
  private envelope?: Diagnostics;
  private gap = false;
  constructor(private readonly ids: { jobId: string; attemptId: string; workerInstanceId: string; workerBuildId: string }, private readonly write?: (sequence: number, diagnostics: Diagnostics, signal: AbortSignal) => Promise<string>, private readonly logger?: DiagnosticLogger) {}
  start(): TransportDiagnostics {
    const t: TransportDiagnostics = { transport_attempt: this.transports.length + 1 as 1 | 2, request_id: randomUUID(), started_at: new Date().toISOString() };
    this.transports.push(t); return t;
  }
  log(event: DiagnosticEvent, outcome?: string) {
    if (!this.envelope || !validateDiagnostics(this.envelope)) return;
    try { this.logger?.({ service: "analysis-worker", event, ...(outcome && ["applied", "unchanged", "stale", "fenced", "failed"].includes(outcome) ? { outcome } : {}), diagnostics: JSON.parse(JSON.stringify(this.envelope)) }); } catch { /* Logging cannot change execution. */ }
  }
  async checkpoint(phase: DiagnosticPhase) {
    if (this.sequence >= 16) { this.gap = true; return; }
    const envelope: Diagnostics = { schema_version: 1, sequence: ++this.sequence, job_id: this.ids.jobId, attempt_id: this.ids.attemptId, phase, updated_at: new Date().toISOString(), worker_build_id: safeBuildId(this.ids.workerBuildId), worker_instance_id: this.ids.workerInstanceId, transports: JSON.parse(JSON.stringify(this.transports)) };
    if (!validateDiagnostics(envelope)) return;
    this.envelope = envelope; this.log(phase);
    if (this.write) {
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Diagnostic checkpoint timeout")); }, 2000); });
        this.log("checkpoint", await Promise.race([this.write(envelope.sequence, envelope, controller.signal), timeout]));
      } catch { this.gap = true; this.log("checkpoint_failed", "failed"); }
      finally { clearTimeout(timer); }
    }
  }
  metadata(): Record<string, unknown> { return { ...(this.envelope ? { diagnostics: this.envelope } : {}), ...(this.gap ? { diagnostic_gap: true } : {}) }; }
}
