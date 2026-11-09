# HTTP Transport Recovery Implementation Plan

> **For agentic workers:** Use the assigned implementation workflow task by task. Root assigns Go and TS ownership; the deep reviewer verifies the combined result. Preserve other agents' edits.

**Goal:** Use the existing second generation for same-account HTTP/SSE recovery after an eligible WebSocket interruption.

**Architecture:** The worker retains the current two-generation limit and chooses HTTP only for the already-authorized recovery. The gateway validates an explicit recovery request, pins the original attached Codex OAuth account, and executes one HTTP request through its existing Responses bridge. The first generation continues to use the configured transport.

**Tech Stack:** TypeScript, Undici, Vitest, Go, coder/websocket, existing JSON diagnostics and fenced SQL finalizers.

**Spec:** Root-approved design in this task; existing contracts in `2026-10-20-transport-recovery.md` and `2026-10-20-durable-analysis-diagnostics.md`.

## Evidence and limits

- Oct 20 NHL and tennis each exhausted two WS generations. All four had HTTP upgrade 101, model response IDs, wrapped EOF in `upstream_read`, and no completed terminal. Gateway-to-worker HTTP delivery completed; the worker lease remained valid. Soccer recovered on its second WS generation while CFB completed on its first.
- No evidence identifies a gateway restart, the 45-minute deadline, or a uniform idle timeout as the cause. The remote server/proxy's internal reason for closing TCP remains unknown.
- The local recovery always repeats WS; it has no transport alternative when WS fails again. This is the actionable reliability gap.
- Historical constraint: `2026-10-03-analysis-timeout.md:21–30` records an HTTP/2 SSE interruption around 901 seconds, followed by WS completions beyond 1,000 seconds. Preserve WS first; HTTP is not guaranteed to be more reliable.
- Official Codex source at revision `48b6a9d8e0b5e0d809a60eac1cb48486d6ba5107`, `codex-rs/core/src/client.rs:2448–2463`, documents switching to HTTP after its retry budget. This supports an alternate transport, not a claim that every provider policy is identical.

## Global constraints

- Exactly one first generation and at most one eligible recovery; no third generation or gateway-internal replay.
- Keep existing recovery error allowlist, authoritative heartbeat, cancellation exclusions, one absolute 45-minute worker budget, and final SQL lease fence.
- Keep the immutable full input, instructions, model `gpt-6-astra`, effort, hosted live search, source inclusion, and Codex OAuth account identity.
- Discard the first partial answer and sources. Save only a verified completed final result, once.
- No paid API credentials/provider fallback, new DB schema, raw error/header logging, or additional live diagnostic model calls.
- `http` already exists in the diagnostics schema; preserve both observed transport records and HTTP status per hop.

## Fixed interface

### TS

- Add `GatewayError.recoveryAccountId?: string` as an optional fifth constructor argument. It is an ephemeral UUID hint from the selected response header `X-LLMs-Account-Id`, never part of safe diagnostics, DB metadata, logs, errors shown to users, or the model body.
- Add `GatewayOptions.transportRecovery?: { transport: "http"; accountId: string }`.
- First call: no recovery option or recovery headers.
- After an eligible WS error plus a valid ephemeral hint and successful ownership check: second call receives the HTTP option with that hint. Missing/invalid hint stops recovery; do not silently repeat WS.
- `runGatewayAnalysis` emits recovery headers only with valid existing correlation UUIDs and `transportAttempt === 2`. Invalid locally supplied recovery options fail before fetch with a fixed error.

### Internal headers

Existing correlation headers remain unchanged. Add:

```text
X-SportsDesk-Upstream-Transport: http
X-SportsDesk-Recovery-Account-Id: <original selected account UUID>
```

Both must be present together. Gateway accepts only exact `http`, ordinal `2`, valid job/attempt/request UUIDs, configured WS mode, and an authenticated authorized route containing the pinned Codex OAuth account. Reject invalid requests before upstream execution with a fixed 400 error. A removed/ineligible pinned account fails closed with a fixed error; never select another account.

Strip both recovery headers and existing correlation headers before upstream dispatch. Never log or persist the recovery account ID. Read only the selected account response header in TS; no header dumps.

### Go context and dispatch

- Introduce request-local `WithCodexHTTPRecovery(ctx context.Context, accountID uuid.UUID) context.Context` and an internal getter. Never mutate shared `Engine.CodexTransport`.
- In dispatch, recovery restricts the authorized attached account set to the pinned eligible Codex OAuth account and uses sequential single-account execution, regardless of route strategy. No parallel branch or account failover.
- In `execUpstream`, that request-local marker skips the WS branch and uses the existing authenticated POST/SSE implementation with the same converted body and endpoint.
- Recovery must not create extra model requests on HTTP transport/terminal failure. Do not refresh/replay a recovery HTTP request on 401; return the failure. The existing non-recovery auth behavior stays unchanged.
- Populate HTTP bridge options with actual `upstreamHTTPStatus` and `gatewayRequestID`, alongside existing protocol/request ID/transport fields. Preserve safe read-error classification and terminal logs.

## Review focus

1. A malformed/replayed first-attempt override must not change transport or call upstream.
2. Concurrent requests must not share the override or change account identity.
3. HTTP failure before first content must not cause hidden account failover or a third generation.
4. A removed pinned account must fail closed, including routes containing paid/API accounts.
5. Deadline/lease loss during checkpoint or backoff must prevent HTTP recovery and preserve the original EOF history.

## Task 1 — Go owner

**Files:** `gateway/patches/0001-sports-desk-compat.patch`, `gateway/README.md`.
Patched source responsibility: `internal/httpserver/server.go`, existing diagnostics header handling, `internal/proxy/proxy.go`, a small transport-recovery context helper if useful, and related Go tests.

- [x] Write RED real-loopback fixtures: WS emits created/partial then abruptly closes; explicit second request completes via HTTP/SSE on the same account.
- [x] Assert WS create count 1, HTTP POST count 1, no alternate account, no WS recreation, same auth/account headers, full converted request parity except WS `type=response.create`, same effort/search/source settings.
- [x] Cover invalid/missing UUIDs, ordinal 1, unsupported transport, missing hint, unattached/wrong-kind account, mixed/parallel route, HTTP 401/429/500/read EOF, and two concurrent recovery/non-recovery requests. No secret/account/correlation headers reach upstream logs; only required authentication reaches the mock upstream.
- [x] Implement request-local selection, single-account dispatch, no replay, and HTTP diagnostic parity.
- [x] Verify HTTP completed carries `upstream_transport=http`, actual upstream HTTP 200, gateway request ID, response ID, and source data; WS remains 101.
- [x] Update README: gateway itself does not reconnect/replay; the worker can make its one explicit same-account HTTP recovery request.
- [x] Run focused tests, then `go test` and `go vet` for `./internal/httpserver/... ./internal/proxy/... ./internal/store/... ./cmd/llms-gateway`; verify pristine pinned-source patch apply and resulting diff.

## Task 2 — TS owner

**Files:** `src/lib/analysis/gateway.ts`, `src/lib/analysis/worker.ts`, their tests. Touch `diagnostics.ts` only if required for safe mapping; no schema changes.

- [x] Write RED parser tests for the ephemeral selected-account UUID surviving interrupted-response error wrapping without entering diagnostics/logs.
- [x] Write RED worker tests: eligible WS interruption selects HTTP only for call 2; immutable context/instructions unchanged; missing/invalid hint stops; all excluded errors still stop.
- [x] Implement the fixed interface and headers. Preserve existing heartbeat/budget/checkpoint/finalization behavior.
- [x] Use the real gateway parser in a WS-error/SSE-success fixture; ensure first partial text/sources are absent, final sources persist, both transport identities and statuses remain in audit, and exactly one finalize occurs.
- [x] Cover HTTP second-call failure, full shared deadline, lease loss, logger/checkpoint failures, and no third call.
- [x] Run focused tests, full Vitest, typecheck, lint and build.

## Combined release gate — root and independent reviewer

- [x] Cross-check the actual Go HTTP diagnostic fixture through TS parser/worker and existing SQL validator without schema edits.
- [x] Verify privacy, account pinning, no hidden replay, first-attempt behavior, and shared budget independently.
- [x] Confirm production is idle and read-only account-pool inspection shows expected Codex OAuth scope; never output credentials or raw account data.
- [x] Roll out gateway first, then worker; keep rollback artifacts. No extra live model probe.
- [x] Use the user's authorized normal retry path for only the interrupted Oct 20 NHL and tennis jobs, preserving prior attempts and original scope. Observe actual completion/failure, transport selection, sources and single finalization. Report live evidence without promising either transport can never disconnect.

## Out of scope

Worker build-ID cleanup, more retries, global HTTP selection, chunked analysis, model/effort changes, provider infrastructure diagnosis beyond available evidence, and unrelated ledger or content changes.


## Verified implementation and production release — 2026-10-20

- Full TypeScript suite: 44 suites / 544 tests; typecheck, lint and final Next production build passed. Independent review passed 129 gateway/worker tests and four Go loopback scenarios.
- The final patch applied cleanly to a fresh pinned archive; four Go package groups and matching `go vet` passed. Patch SHA-256: `174d71b1b9a79bf148e2ba2a80d3cd373f26e3f7d0e6f6515e589ccbe686980d`.
- Actual Go HTTP diagnostics passed through the real TS worker and existing SQL validator/checkpoint/finalizer in a rolled-back transaction. No schema migration was needed.
- Read-only production routing check found one attached healthy Codex OAuth account and no attached API-key accounts.
- Earlier Railway uploads returned `UPLOAD_FAILED` / `Deploys have been paused temporarily` before creating a deployment. A bounded upload at 21:43 UTC succeeded without any plan, billing, cost-limit, or service configuration change. This establishes that the upload gate reopened; the provider's original internal reason and exact restriction scope remain unverified. Preserve the earlier blocked-release receipt as historical evidence.
- The frozen allowlisted gateway was deployed first as `e43bf7bd-69ef-489d-a323-f38af30a4c1d`, followed by worker `7479e57b-c65a-43a5-8c4e-9b7b1ea3ffb1`. Both reached `SUCCESS` with one `RUNNING` instance. The web deployment stayed at `59e1e596-4bb5-4052-80ed-e39c1d67e2b8`.
- The gateway deployment build passed all four Go package tests. Direct read-only SSH confirmed the new `RAILWAY_DEPLOYMENT_ID`, binary SHA-256 `a3b637058d134a2ee45d90c2269ab454a9c9b100c6bf8a6af8c4e74f4c7f5f8f`, and both new recovery markers. The source patch provenance is established by the frozen upload and successful build; source text is not retained in the gateway runtime image.
- All 108 worker runtime source, script, and package files checked against the frozen manifest matched. The changed runtime `gateway.ts` hash is `787dc968228adfd6d5ae34805363f063fef4171951176606ae88e6eb7bee023b`; `worker.ts` is `eecdedea61839f538e6e73d8d8fb9c411db064787d40a635b65638d5cd2e20d9`. The runtime deployment ID matched the new worker deployment. This does not change the separate worker build-ID diagnostic field.
- Private `GET /models` returned HTTP 200 with five models after each rollout. Final checks at 21:50:47 UTC found zero queued/running jobs and public web HTTP 200. No generation probe, application retry, database change, or paid API fallback was performed by the deployment verification step.
- Frozen candidate and rollback artifacts remain preserved. The private receipt `hobby-deploy-recovery-20261020.json` has mode `0600` and SHA-256 `64c6b4ba3420e74485fe9b5aa895e6bc92556666bc31b603378ecf5a914477b2`; it includes deployment identities, runtime hashes, health evidence, and the supported direct SSH verification method. The original blocked-release receipt remains unchanged.
- The normal owner retry route accepted each of the two original Oct 20 jobs exactly once (HTTP 202), preserving user messages, request keys, scopes and interrupted attempt 1. Both attempt 2 jobs completed and have exactly one linked assistant result. NHL completed at 22:00:40 UTC and tennis at 22:03:01 UTC. Root independently re-read both completed states and saved-result flags through Supabase REST.
- Both successful attempts used one WebSocket transport (upstream HTTP 101, gateway HTTP 200, terminal `completed`); no retry/root cause was recorded. The new HTTP recovery path therefore did not activate in these live runs. Its failure/recovery behavior is supported by the earlier local integration checks, not by a forced production interruption.
- Result metadata contains searched/verified flags and sources (NHL 142, tennis 173); these flags do not independently prove every fact. NHL coverage is `unverified` with 11/11 assessed and independent schedule validation unsupported; tennis is `incomplete` with 100/101 assessed and one missing event. Both structured extractions are incomplete with `extraction_failure_code=unofficial_source` and `recommendations_persisted=false`; saved chat results must not be described as complete analysis-board updates.
- Private final retry receipt `retry-analyze-today-20261020-nhl-tennis-final-monitor.json` is mode `0600`, SHA-256 `1facf59bc4dd3b5e87bd2df8cd00e96164b3d7f47369d7770617fdef054fd5ac`. No paid API fallback or extra owner retry was used. Prior partial attempts have no attached result. A pre-run bet-record snapshot was not captured, so this receipt does not establish an unchanged bet-record count.
