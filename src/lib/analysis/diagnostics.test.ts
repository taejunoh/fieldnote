import { describe, expect, it } from "vitest";
import { classifyTransportCause, validateGatewayDiagnostics, validateDiagnostics } from "./diagnostics";

describe("safe transport diagnostics", () => {
  it("classifies a bounded cyclic cause chain without leaking arbitrary error data", () => {
    const inner = Object.assign(new Error("TOKEN prompt cookie rawstack"), { code: "ECONNRESET" });
    const outer = Object.assign(new Error("private URL header"), { cause: inner });
    Object.assign(inner, { cause: outer });
    const result = classifyTransportCause(outer);
    expect(result).toMatchObject({ root_cause: "connection_reset", safe_message_code: "connection_reset", cause_chain: [{ type: "unknown" }, { type: "syscall", code: "ECONNRESET" }] });
    expect(result.error_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(/TOKEN|prompt|cookie|rawstack|private|header/);
    expect(classifyTransportCause({ code: "TOKEN", message: "private" })).toMatchObject({ root_cause: "unknown", cause_chain: [{ type: "unknown" }] });
  });
  it("rejects malicious nested fields, worker-owned fields and oversized gateway subsets", () => {
    expect(validateGatewayDiagnostics({ schema_version: 1, stage: "upstream_read", root_cause: "unexpected_eof" })).toBe(true);
    for (const extra of [{ request_id: "123" }, { cause_chain: [{ type: "unknown", message: "TOKEN" }] }, { root_cause: "TOKEN" }, { close_reason: "TOKEN" }, { event_count: 2147483648 }]) {
      expect(validateGatewayDiagnostics({ schema_version: 1, ...extra })).toBe(false);
    }
  });
  it("validates the durable schema with exact IDs, bounded sequence and transport count", () => {
    const envelope = { schema_version: 1, sequence: 1, job_id: "11111111-1111-1111-1111-111111111111", attempt_id: "22222222-2222-2222-2222-222222222222", phase: "transport_started", updated_at: "2026-10-20T00:00:00.000Z", worker_build_id: "unknown", worker_instance_id: "33333333-3333-3333-3333-333333333333", transports: [{ transport_attempt: 1, request_id: "44444444-4444-4444-4444-444444444444", started_at: "2026-10-20T00:00:00.000Z" }] };
    expect(validateDiagnostics(envelope)).toBe(true);
    expect(validateDiagnostics({ ...envelope, sequence: 17 })).toBe(false);
    expect(validateDiagnostics({ ...envelope, transports: Array(3).fill(envelope.transports[0]) })).toBe(false);
    expect(validateDiagnostics({ ...envelope, prompt: "TOKEN" })).toBe(false);
    expect(validateDiagnostics({ ...envelope, worker_build_id: "private" })).toBe(false);
  });
});

it("accepts the exact Go-generated synthetic transport fixture including provider request correlation", async () => {
  const { readFileSync } = await import("node:fs");
  const fixture = JSON.parse(readFileSync("src/lib/analysis/fixtures/go-transport-diagnostics.json", "utf8"));
  expect(validateGatewayDiagnostics(fixture)).toBe(true);
  expect(fixture.upstream_request_id).toBe("req_fixture_123");
});

it.each([
  ["UND_ERR_RESPONSE_STATUS_CODE", "http_rejected"], ["JSON_SYNTAX", "json_error"], ["WS_MESSAGE_TOO_BIG", "message_too_big"],
  ["ERR_TLS_CERT_ALTNAME_INVALID", "tls_error"], ["UND_ERR_CONNECT_TIMEOUT", "deadline_exceeded"],
])("classifies stable code %s without reading its message", (code, expected) => {
  expect(classifyTransportCause({ code, message: "CANARY token" }).root_cause).toBe(expected);
});
