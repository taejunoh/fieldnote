# Pinned openllms gateway

This image builds the preserved `goodtekxyz/openllms` source archive for commit `76945701e6822512ca7370d5583db6822e16eb83` and applies `patches/0001-sports-desk-compat.patch`. The upstream remote no longer serves that pinned commit reliably, so the build uses the committed source snapshot in `vendor/` instead of resolving a moving remote ref. `vendor/PROVENANCE.txt` records the source commit and archive SHA-256; Docker verifies the checksum before extraction. The snapshot contains only the pinned committed source tree, with no Git metadata, credentials, or runtime data. It preserves the pinned code and applies the existing compatibility patch without changing model behavior. The Docker build runs `go test ./internal/httpserver/... ./internal/proxy/... ./internal/store/... ./cmd/llms-gateway` before producing the binary. It makes no OAuth or model request. The proxy's upstream HTTP client defaults to a bounded 45-minute total request timeout. `OPENLLMS_UPSTREAM_TIMEOUT_SECONDS` configures this budget as an integer from 60 through 3600 seconds; invalid values fail startup without printing the supplied value. The app worker uses the same configuration with an additional 60 seconds to receive terminal diagnostics (46 minutes by default).

```sh
export OPENLLMS_BOOTSTRAP_TOKEN="$(openssl rand -hex 32)"
docker compose -f gateway/compose.yaml build
docker compose -f gateway/compose.yaml up -d
curl -fsS http://127.0.0.1:8080/health
```

The compose service binds only to loopback and keeps its SQLite database and secret files in the `openllms-data` volume. The bootstrap token is generated locally, never checked into the repository, and must be present in the shell when Compose creates or recreates the container. Keep it private. The app worker calls `/r/<route>/v1/chat/completions`; the gateway does not run background jobs by itself.

## Optional Codex WebSocket transport

`OPENLLMS_CODEX_TRANSPORT` accepts exactly `http` or `ws` and defaults to `http`. Invalid values fail startup with a fixed message. `ws` applies only to Codex OAuth Responses requests; other providers and credential types keep HTTP. The WebSocket dependency is pinned to `github.com/coder/websocket v1.8.14` with module checksums. The same transformed model, reasoning effort, full input, hosted live search, and source inclusion are sent as one `response.create` message using the Codex WebSocket beta header. The existing terminal, citation, and verification rules apply to both transports. `llms.terminal.upstream_transport` reports only `http` or `ws`.

For local Compose, export `OPENLLMS_CODEX_TRANSPORT=ws` before `docker compose -f gateway/compose.yaml up -d --force-recreate`. Compose forwards this setting and `OPENLLMS_UPSTREAM_TIMEOUT_SECONDS` into the container, defaulting to `http` and `2700` respectively. Shell changes take effect when the container is recreated.

The configured upstream budget covers the entire WebSocket handshake, create write, and reads. A completed terminal closes the connection immediately. The gateway itself does not reconnect or replay a failed WebSocket request. After an eligible interrupted terminal, the worker may send one explicit second request using HTTP/SSE on the same attached Codex OAuth account; the gateway pins that request to the supplied account and never fails over or replays it. Once a WebSocket create write starts, even an ambiguous partial-write error becomes an interrupted terminal and cannot execute another account. Routes whose parallel pool includes Codex OAuth accounts use sequential dispatch with `ws` to preserve this guarantee. An OAuth handshake 401 may refresh credentials before the first create; errors after create do not refresh or replay.

For a handshake capability check using the deployed binary and its existing environment:

```sh
/llms-gateway --probe-codex-websocket
```

This separate process opens an existing SQLite store in read-only mode, reads sealed credentials for the first healthy Codex OAuth account, and performs one handshake to the exact official Codex endpoint. It follows no redirects, sends no application messages or model request, performs no credential refresh or database migration, and starts no server or background task. Output is limited to `ok`, `http_status`, `http_protocol`, and a fixed `error_code`; a successful handshake does not establish model execution or long-running stream success. The command exits zero on handshake success and one otherwise. PostgreSQL probe storage is unsupported. The transport remains disabled unless the environment is explicitly changed to `ws`.

## First setup and Codex authorization

Bootstrap once, then securely save the returned gateway API key. The bootstrap response is the only time the key is shown. These commands require `jq` and use shell variables so the key is not printed in terminal output:

```sh
export LLMS_API_BASE=http://127.0.0.1:8080
BOOT_RESPONSE="$(curl -fsS -X POST "$LLMS_API_BASE/control/v1/bootstrap" \
  -H "X-Bootstrap-Token: $OPENLLMS_BOOTSTRAP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"login":"sports-desk","project_name":"sports-desk","key_name":"owner"}')"
export LLMS_API_KEY="$(printf '%s' "$BOOT_RESPONSE" | jq -er .api_key)"
unset BOOT_RESPONSE
```

After saving the key, disable bootstrap without deleting the volume:

```sh
export OPENLLMS_BOOTSTRAP_TOKEN=''
docker compose -f gateway/compose.yaml up -d --force-recreate
```

The existing gateway key remains valid. Keep `OPENLLMS_BOOTSTRAP_TOKEN` set to an empty string for later Compose recreations so bootstrap stays disabled.

At this pinned commit, `/console` redirects to `/install`, but its API endpoints remain available and accept the gateway bearer key. The account owner starts the Codex device flow, opens the returned `verification_uri`, enters `user_code`, and approves the connection. The following only starts the flow; it does not approve it:

```sh
START_RESPONSE="$(curl -fsS -X POST "$LLMS_API_BASE/console/api/connect/codex/start" \
  -H "Authorization: Bearer $LLMS_API_KEY" \
  -H 'Content-Type: application/json' -d '{}')"
printf '%s' "$START_RESPONSE" | jq '{verification_uri,user_code,interval}'
PENDING_ID="$(printf '%s' "$START_RESPONSE" | jq -er .pending_id)"
unset START_RESPONSE
```

After approving in the browser, poll at no faster than the returned `interval` until HTTP 201 creates the Codex account. HTTP 202 means authorization is still pending. This request returns the new account ID without printing OAuth tokens:

```sh
curl -i -sS -X POST "$LLMS_API_BASE/console/api/connect/codex/poll" \
  -H "Authorization: Bearer $LLMS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"pending_id\":\"$PENDING_ID\",\"name\":\"sports-desk\"}"
```

Create one route and attach only that Codex account. Use `/control/v1/routes` and `/control/v1/routes/<slug>/accounts` with the same bearer key, as documented in the pinned upstream [OSS guide](https://github.com/goodtekxyz/openllms/blob/76945701e6822512ca7370d5583db6822e16eb83/deploy/oss/README.md). Do not attach a paid OpenAI API key. No live model call is needed for bootstrap or OAuth; a later model capability check will consume account usage.

## Adapter contract

When the upstream terminal Responses object reports them, `llms.terminal` also includes `upstream_reported_model`, `upstream_reported_reasoning_mode`, and `upstream_reported_reasoning_effort`. These bounded, nonempty strings come from the terminal `response.model` and `response.reasoning.mode` / `response.reasoning.effort` fields. The requested model alias in Chat Completions chunks is not evidence of the model that answered. Missing or invalid upstream values stay unreported; the app adapter returns `null` for each missing value.

Send `reasoning_effort` as `medium` or `xhigh`, a function tool named `web_search`, `tool_choice: "required"`, and `llms.web_search.mode: "live"`. The bridge forwards the effort as upstream `reasoning.effort`, maps the function shim to the hosted `web_search` tool, enables `external_web_access`, and requests `web_search_call.action.sources` in the Responses output. Any other nonempty effort is rejected with HTTP 400 before an upstream request.

Aggregate JSON has `llms.terminal` and streaming responses put it on the final Chat Completions SSE chunk, followed by `[DONE]`. `llms.terminal.status` is `completed`, `incomplete`, `failed`, `cancelled`, or `interrupted` (the stream ends without a terminal event). The object also has `upstream_response_id` when known and `error` containing a safe, allowlisted code when upstream supplies an error or incomplete details. Interrupted streams report `upstream_timeout` for deadline expiration, `upstream_transport_error` for a read failure, or `upstream_eof` for clean EOF without a terminal event. The response ID is captured from `response.created` before any text. Upstream messages and arbitrary error payloads are omitted. A genuine terminal event finishes conversion immediately, including when the upstream leaves the connection open. An accepted execution that ends without a terminal event emits the final diagnostic chunk and `[DONE]`; it is not automatically replayed against another account. Only `completed` means success. Noncompleted results use `finish_reason: "error"`, and partial text must not be finalized as a successful analysis.

Terminal diagnostics are bounded structured values: `transport_error_kind` is one of `deadline_exceeded`, `context_cancelled`, `unexpected_eof`, `connection_reset`, `connection_closed`, `scanner_token_too_long`, or `unknown_transport_error` when a read error occurs. `request_context_cancelled` reports whether the incoming request context ended; it does not establish why. `upstream_elapsed_ms` and `last_event_age_ms` are nonnegative integers capped at 86,400,000, and `event_count` counts parsed JSON events up to 1,000,000. `upstream_http_protocol` is reported only as `HTTP/1.1` or `HTTP/2.0`. `request_id` is copied only from the upstream `X-Request-Id` header when it contains 1–128 ASCII letters, digits, underscores, or hyphens. Unknown protocol and invalid request IDs are omitted. No raw error text, headers, bodies, credentials, or URLs enter these diagnostic fields. A transport failure alone does not prove an upstream provider time limit.

Bridge terminal events may include `websocket_close_code` (an integer from 1000 through 4999), `websocket_message_too_big` (`true` only when the fixed 8 MiB WebSocket message-read limit is exceeded), `websocket_protocol_error` (`true` for a non-text or malformed JSON WebSocket message), and `last_event_type` (a fixed Responses event name or `other` for an unrecognized event type, including hosted web-search progress). The close and message-limit fields apply only to WebSocket transport. These fields preserve transport evidence without exposing close reasons, raw errors, or event payload text. A close without `response.completed` remains interrupted EOF for close codes 1000 and 1001; abnormal close codes remain interrupted transport failures. Focused local loopback coverage for normal/abnormal closes, peer close 1009 versus the local read limit, terminal completion, and no replay is in `TestSportsDeskWebSocketCloseAndReadLimitDiagnostics` and `TestSportsDeskWebSocketSingleCreateAndParity` in `internal/proxy`.

The official [Responses streaming event contract](https://github.com/openai/openai-node/blob/main/src/resources/responses/responses.ts) defines a top-level `type: "error"` event. The bridge treats this as `failed`, stops reading immediately, and exposes only the existing safe error-code allowlist (`max_output_tokens`, `content_filter`, `server_error`, `rate_limit_exceeded`, `invalid_prompt`, `cancelled`), falling back to `upstream_error` for unknown or absent codes.

`llms.citations` contains deduplicated `{url, title?}` entries from `url_citation` annotations. `llms.hosted_tools` retains each hosted tool's status and action, including requested `web_search_call.action.sources` when upstream supplies them. The bridge passes through upstream evidence; it does not create citations from model text. Empty or absent citations and source lists mean unverified, not searched successfully. A response without a completed web search and valid source URLs must not be marked verified by the app.

When every account on a cooling-down route is Codex OAuth and each has a provider usage snapshot refreshed within 10 minutes showing a depleted 5-hour or 7-day window with a future reset, the gateway returns HTTP 503 with `{"error":"quota_exhausted","reset_at":"...","pool_size":N}`. This is the only gateway signal for `waiting_quota`. An ordinary 429, stale or missing usage, and mixed routes retain the generic `no_usable_accounts` response. The first upstream 429 may still be returned as 429; the quota signal applies when the route is subsequently unavailable and fresh usage confirms depletion. No paid API fallback is configured.

For a local, credential-free check against the preserved pinned source:

```sh
mkdir -p /tmp/openllms-check
tar -xf gateway/vendor/openllms-76945701e6822512ca7370d5583db6822e16eb83.tar -C /tmp/openllms-check
git -C /tmp/openllms-check apply --check "$PWD/gateway/patches/0001-sports-desk-compat.patch"
git -C /tmp/openllms-check apply "$PWD/gateway/patches/0001-sports-desk-compat.patch"
docker run --rm -v /tmp/openllms-check:/src -w /src golang:1.24.5-bookworm go test ./internal/httpserver/... ./internal/proxy/... ./internal/store/... ./cmd/llms-gateway
```
