# Durable analysis diagnostics plan

User requests enough future evidence to diagnose interruptions. Keep the deployed bounded recovery (two generations maximum, one total deadline, lease fencing, fresh partial accumulators) unchanged.

## Ownership and execution

- Go implementer: gateway compatibility patch only; upstream transport and HTTP lifecycle instrumentation and fixtures.
- TS implementer: analysis gateway/worker, new diagnostics helper/tests, scripts/analysis-worker.ts.
- SQL implementer: new diagnostics migration and transaction-rollback tests only.
- Root coordinates and verifies; independent deep review gates deployment. Existing source backup: private-verification/observability-transport-recovery-20261020-before. Never stage the untracked child application into its unrelated parent repository.

## Durable contract

DB namespace: provider_metadata.diagnostics on both analysis_jobs and analysis_attempts.
RPC public.record_gateway_diagnostics(p_job_id uuid, p_attempt_id uuid, p_worker_id text, p_sequence integer, p_diagnostics jsonb) returns text: applied|unchanged|stale|fenced.
SECURITY INVOKER, search_path public, explicit auth.role()=service_role, execute service_role only. Reject invalid input/conflicting equal sequence using 22023, unauthorized using 42501. Lock job then attempt, check clock_timestamp() after locks, require openllms/running/current attempt/matching text lease_owner/valid lease and matching running attempt worker/job. Never extend lease. Only replace diagnostics key, preserve other metadata.

Required diagnostics root keys:
schema_version=1; sequence=1..16 matching RPC; job_id UUID; attempt_id UUID; phase enum; updated_at UTC ISO8601; worker_build_id SHA/deployment UUID/unknown; worker_instance_id UUID; transports array max2.
Each transport requires transport_attempt=1|2, request_id UUID, started_at UTC ISO8601.
Optional transport keys (omit unobserved, never fabricate): gateway_request_id, upstream_request_id, upstream_response_id, gateway_build_id, ended_at, elapsed_ms, last_event_at, last_event_age_ms, last_heartbeat_at, heartbeat_outcome, gateway_http_status, upstream_http_status, upstream_http_protocol, upstream_transport, stage, event_count, last_event_type, upstream_terminal_status, downstream_delivery_outcome, error_origin, root_cause, cause_chain, error_fingerprint, safe_message_code, close_frame_received, websocket_close_code, close_reason_code, websocket_message_too_big, websocket_protocol_error, cancellation_origin, retry_decision, retry_reason.
Cause chain max4, entries only {type, code?}; type groups and codes use fixed shared allowlists. Fingerprint SHA256 of normalized safe structure only, never raw errors. Bounds: JSON max16KiB, max2 transports, sequence max16. Strict recursive keys/types/format/number/string limits in TS and SQL.

Enums:
- phase: transport_started|transport_ended|retry_planned|finished
- stage: worker_gateway_fetch|worker_gateway_read|upstream_dial|upstream_create_write|upstream_read|json_decode|downstream_write|worker_control|terminal
- error_origin: worker_gateway|gateway_upstream|gateway_downstream|worker_control
- root_cause: deadline_exceeded|context_cancelled|unexpected_eof|connection_reset|connection_closed|connection_refused|dns_error|tls_error|http_rejected|websocket_close|message_too_big|protocol_error|json_error|scanner_token_too_long|unknown
- cancellation_origin: worker_deadline|gateway_deadline|lease_lost|downstream_disconnect|shutdown|unknown
- downstream_delivery_outcome: completed|write_failed|cancelled|unknown
- heartbeat_outcome: owned|lost|check_failed
- retry_decision: retry|stop
- retry_reason: eligible_transport|attempt_limit|excluded_error|deadline|lease_lost|ownership_check_failed|cancelled
- close_reason_code: empty|normal_shutdown|server_restart|overloaded|unrecognized (exact known full-string mapping only)

Worker headers: X-SportsDesk-Job-Id, X-SportsDesk-Attempt-Id, X-SportsDesk-Transport-Attempt, X-SportsDesk-Request-Id. UUIDs except ordinal1|2. Gateway generates X-SportsDesk-Gateway-Request-Id response header. Never forward these internal correlation headers upstream. Gateway safe transport subset is llms.terminal.diagnostics with schema_version1. TS validates and merges only safe gateway fields; never accept replacement of worker-owned IDs/start/ordinal.

HTTP status is distinct on worker->gateway and gateway->upstream. HTTP200 is never treated as model completion. Upstream terminal received and downstream write outcome are distinct: final delivery may only be observed after writing terminal, so log it at gateway; do not invent it in DB. Preserve close-frame absence vs actual frame/code and known cancellation vs unknown.

## Lifecycle and retention

Checkpoint start/end/retry boundaries before terminal RPC; same safe envelopes in JSON lifecycle logs, no delta/normal heartbeat logging. Include service/deployment and instance identities. Track retry, lease loss, cancellation, finalize rejection/success, shutdown safely. Max16 sequence checkpoints and bounded transports; final metadata includes diagnostics. Ensure failure/finalize/reaper whole-metadata replacement cannot erase the last checkpoint, including SIGKILL then lease expiry. Checkpoint failure is observable but must not grant ownership or change model/retry/business behavior.

Never log raw messages/stacks/URLs/addresses/headers/tokens/cookies/account/owner IDs/prompts/model bodies/close reasons. Use safe enums, cause groups/codes and structure fingerprint. Arbitrary string masking is insufficient. A remote unexplained TCP close cannot reveal the remote server's internal cause; preserve observable evidence honestly.

## Verification and rollout gates

- [x] TDD fixtures: EOF/reset/handshake/dial/create-write/read/JSON/downstream-write distinguished, bounded unknown diagnostics.
- [x] Malicious message/header/prompt/token fixtures prove no leaks in logs/DB; bad IDs and cyclic causes bounded.
- [x] Retry failure then success retains both requests and first error; recovery allowlist and 45minute budget unchanged.
- [x] Normal completed stream reader cancellation does not become analysis failure.
- [x] Durable checkpoint service-only/fencing/idempotence/stale/conflicting sequence/bounds/recursive allowlist tests, transactional rollback.
- [x] SIGKILL-equivalent checkpoint then lease-expiry/fail preserves diagnostics; final successful save preserves diagnostics.
- [x] TS full suite/type/lint/build and Go related packages/vet, independent security/spec review.
- [x] Fresh active-job=0, sanitized new staging and rollback contexts, migration first then gateway and worker; source hashes/runtime health.
- [x] At most one private authenticated malformed-JSON production request, only after fixture proves dispatch/upstream calls0. Capture actual HTTP status, request IDs, gateway JSON validation end log. No model calls, subscription use or paid API needed.

## Fixed TypeScript/SQL bounds and implementation status

- UTC timestamps use canonical millisecond ISO form (`YYYY-MM-DDTHH:mm:ss.SSSZ`). Correlation job/attempt/worker/request/gateway IDs use canonical UUID syntax. Provider `upstream_request_id` uses `[A-Za-z0-9_-]{1,128}`; it is not required to be a UUID. `upstream_response_id` uses `[A-Za-z0-9_.:-]{1,128}`.
- Build IDs are `unknown`, 40/64 hexadecimal SHA, or UUID. Integer elapsed/event values are 0..2147483647; HTTP status 100..599; WebSocket code 1000..4999. Ordered transport ordinals are 1 then 2. Empty transport/cause arrays are allowed.
- Exact shared enum/code tables are exported by `src/lib/analysis/diagnostics.ts` (`ROOT_CAUSES`, `CAUSE_TYPES`, `CAUSE_CODES`, `EVENT_TYPES`) and matched by the SQL validator. Arbitrary code strings are omitted. Gateway subsets cannot supply worker request IDs, ordinal, start/end time, heartbeat, retry decisions or actual worker HTTP status. Gateway subset `elapsed_ms` is validated then discarded; durable transport `elapsed_ms` always measures worker dispatch/read duration using its local monotonic clock. Existing `llms.terminal.upstream_elapsed_ms` retains the separate upstream observation interval.
- Checkpoint writes use a 2-second abort signal and bounded wait; failures set sibling metadata `diagnostic_gap=true`. They never grant ownership. Logging exceptions cannot change business execution.
- [x] TS helper, gateway correlation/stages, bounded cause chains and normalized fingerprints tested RED→GREEN.
- [x] TS checkpoint ordering, retained two request IDs/first error, fenced non-ownership, hanging writes and throwing log sink tested RED→GREEN.
- [x] Actual Go fixture → TypeScript parser/worker → SQL rollback persistence contract. Go fixture SHA256 `fe7daa86be00db55e8b772f05f93cc92e1e682f08b1540212e1fc1f9c7970d43`; emitted TS checkpoint SHA256 `42f3841d7c429f27bc0612a823979275494858140a689bc3fcab7f4e04c0cb08` applied by the local SQL RPC with exact JSONB equality on job and attempt, then rolled back. Provider request ID, stage, cause, fingerprint and both worker request IDs survived.
- [x] Final combined verification and independent review.

## Verification evidence and limits

- Application: 44 suites / 528 tests, TypeScript, lint and production build passed after the final deadline/lease diagnostic correction.
- Gateway: four related Go package groups and vet passed, plus independent real HTTP/WebSocket fixtures covering correlation, abrupt close, private-data canaries, Flush errors, optional Flusher support and malformed JSON before dispatch.
- Database: new gateway_diagnostics plus existing openllms_worker, common_policy_attempts and analysis_input_snapshot rollback fixtures passed. The exact Go-produced safe subset was parsed by the real TypeScript gateway/worker and persisted unchanged by the actual SQL checkpoint RPC in a rolled-back transaction.
- Pre-existing test limitation: gateway_conversation.sql's whole provider_metadata equality assertion fails both before and after this migration because the existing common-policy audit trigger adds common_policy:null. This unrelated fixture was not changed; do not report every SQL test as passing.
- Diagnostic metadata is excluded from future model input: context.ts rebuilds recent message metadata with coverage only, and summary input selects message text fields.
- Production validation is deliberately model-free: an authenticated malformed JSON request must be rejected before upstream dispatch and correlated to start/end logs. This validates HTTP observability, not a deliberately interrupted production model stream. Stream failures and recovery are covered by deterministic fixtures.

Production database rollout (2026-10-20): migration 202610200001_gateway_diagnostics.sql was applied once as an explicit BEGIN/COMMIT transaction through the exact target-linked Management API after a production rollback-only fixture passed. RPC, validator and both retention triggers are present; service_role execution is allowed and anon/authenticated execution denied. The migration-history version was not inserted into supabase_migrations; this was a manually verified SQL rollout, not a db-push history reconciliation. Do not infer migration history from object presence or blindly push previously manual migrations.

Production rollout verification completed: Gateway08000a35 and Worker297b512a healthy; worker2slots and runtime hashes match. One authenticated malformed-JSON request returned actualHTTP400 and a generated gateway requestUUID; the observed start/rejected(json_decode, upstream_call=false)/ended records preserve all synthetic caller correlationIDs and the actual gateway buildUUID. No model or subscription request was used. PublicappHTTP200 and activejobs0 confirmed. Detailed evidence is in the private0600 production release receipt.
