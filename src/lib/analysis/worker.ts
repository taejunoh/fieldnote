import { stripAnalysisCandidateBlocks } from "./display-candidates";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DiagnosticRecorder, ROOT_CAUSES, isUUID, validateDetails, type Diagnostics, type DiagnosticLogger, type SafeTransportDetails, type RootCause } from "./diagnostics";
import { instructionsForContext, resultsReviewInstructions } from "./context";
import { prepareResultsReview } from "./results-review";
import { buildReviewUsageAudit } from "./review-usage";
import type { CommonPolicyVersion } from "../common-policy";
import { loadAnalysisContext } from "./data";
import { GatewayError, runGatewayAnalysis, type GatewayOptions, type GatewayResult, type GatewaySafeDiagnostics, type GatewaySafeEventType } from "./gateway";
import { DEFAULT_UPSTREAM_TIMEOUT_SECONDS, validateUpstreamTimeoutSeconds, workerTransportTimeoutMs } from "./timeout";
import { extractCoverageReport, isRecheckRequest, resolveAnalysisScope, type AnalysisScope } from "./coverage";
import { formatCoverageReason } from "./coverage-labels";
import { extractAnalysisRecord, sourcedEventKey } from "./record";
import { extractEvaluationReport } from "./evaluation";
import { CLARIFICATION_CONTENT, CLARIFICATION_PURPOSE, extractResponsePurpose, requiresFreshRequest } from "./response-purpose";

export type ClaimedJob = {
  id: string;
  owner_id: string;
  sport_id: string;
  user_message_id: string | null;
  kind: string;
  model: string;
  effort: string;
  current_attempt_id: string;
};

export type CompletionPayload = { version: 1; result: GatewayResult; checked_at: string };
export type StoredCompletion = CompletionPayload & { original_attempt_id: string; input_snapshot: Record<string, unknown> };

export interface WorkerStore {
  claim(workerId: string): Promise<ClaimedJob | null>;
  heartbeat(jobId: string, attemptId: string, workerId: string, executionStarted: boolean): Promise<boolean>;
  context(job: ClaimedJob): Promise<string>;
  saveInputSnapshot(jobId: string, attemptId: string, workerId: string, snapshot: Record<string, unknown>): Promise<boolean>;
  loadCompletion(jobId: string, attemptId: string, workerId: string): Promise<StoredCompletion | null>;
  saveCompletion(jobId: string, attemptId: string, workerId: string, completion: CompletionPayload): Promise<boolean>;
  finalize(jobId: string, attemptId: string, workerId: string, content: string, metadata: Record<string, unknown>, providerResponseId: string | null): Promise<string>;
  finalizeConversation(jobId: string, attemptId: string, workerId: string, content: string, metadata: Record<string, unknown>, providerResponseId: string | null): Promise<string>;
  fail(jobId: string, attemptId: string, workerId: string, status: string, error: string, metadata: Record<string, unknown>): Promise<boolean>;
  summarize(job: ClaimedJob): Promise<void>;
  recordDiagnostics?(jobId: string, attemptId: string, workerId: string, sequence: number, diagnostics: Diagnostics, signal?: AbortSignal): Promise<string>;
}

export type SummaryMessage = { id: string; role: string; content: string; created_at: string };

export function buildSummaryCandidate(messagesNewestFirst: SummaryMessage[], summarizedIds: Set<string>) {
  const unsummarizedOld = messagesNewestFirst.slice(32).reverse().filter((message) => !summarizedIds.has(message.id));
  if (unsummarizedOld.length < 20) return null;
  const chunk = unsummarizedOld.slice(0, 20);
  return {
    source_message_ids: chunk.map((message) => message.id),
    content: `대화 발췌 요약 (원문 메시지 ID로 추적 가능, 최신 채택 기준보다 낮은 우선순위):\n${chunk.map((message) => `[${message.created_at} ${message.role} ${message.id}] ${message.content.replace(/\s+/g, " ").slice(0, message.role === "user" ? 2000 : 500)}`).join("\n")}`,
  };
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`${label} is missing`);
  return value;
}

export function createSupabaseWorkerStore(db: SupabaseClient): WorkerStore {
  return {
    async claim(workerId) {
      const { data, error } = await db.rpc("claim_gateway_job", { p_worker_id: workerId, p_lease_seconds: 120 });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row || null;
    },
    async heartbeat(jobId, attemptId, workerId, executionStarted) {
      const { data, error } = await db.rpc("heartbeat_gateway_job", {
        p_job_id: jobId, p_attempt_id: attemptId, p_worker_id: workerId,
        p_lease_seconds: 120, p_execution_started: executionStarted,
      }).abortSignal(AbortSignal.timeout(10_000));
      if (error) throw error;
      return data === true;
    },
    async context(job) {
      const [sportResult, messageResult] = await Promise.all([
        db.from("sports").select("id,slug").eq("id", job.sport_id).eq("owner_id", job.owner_id).single(),
        db.from("messages").select("content,created_at").eq("id", required(job.user_message_id, "user_message_id")).eq("owner_id", job.owner_id).single(),
      ]);
      if (sportResult.error) throw sportResult.error;
      if (messageResult.error) throw messageResult.error;
      return loadAnalysisContext(db, job.owner_id, sportResult.data, messageResult.data.content, { kind: job.kind, requestCreatedAt: messageResult.data.created_at, requestMessageId: job.user_message_id || undefined });
    },
    async saveInputSnapshot(jobId, attemptId, workerId, snapshot) {
      const { data, error } = await db.rpc("save_gateway_input_snapshot", { p_job_id: jobId, p_attempt_id: attemptId, p_worker_id: workerId, p_snapshot: snapshot });
      if (error) throw error;
      return data === true;
    },
    async loadCompletion(jobId, attemptId, workerId) {
      const { data, error } = await db.rpc("load_gateway_completion", { p_job_id: jobId, p_attempt_id: attemptId, p_worker_id: workerId }).abortSignal(AbortSignal.timeout(10_000));
      if (error) throw error;
      return data as StoredCompletion | null;
    },
    async saveCompletion(jobId, attemptId, workerId, completion) {
      const { data, error } = await db.rpc("save_gateway_completion", { p_job_id: jobId, p_attempt_id: attemptId, p_worker_id: workerId, p_completion: completion }).abortSignal(AbortSignal.timeout(10_000));
      if (error) throw error;
      return data === true;
    },
    async finalize(jobId, attemptId, workerId, content, metadata, providerResponseId) {
      const { data, error } = await db.rpc("finalize_gateway_completion", {
        p_job_id: jobId, p_attempt_id: attemptId, p_worker_id: workerId,
        p_content: content, p_metadata: metadata, p_provider_response_id: providerResponseId, p_conversation: false,
      }).abortSignal(AbortSignal.timeout(10_000));
      if (error) throw error;
      return required(data, "finalized message ID");
    },
    async finalizeConversation(jobId, attemptId, workerId, content, metadata, providerResponseId) {
      const { data, error } = await db.rpc("finalize_gateway_completion", {
        p_job_id: jobId, p_attempt_id: attemptId, p_worker_id: workerId,
        p_content: content, p_metadata: metadata, p_provider_response_id: providerResponseId, p_conversation: true,
      }).abortSignal(AbortSignal.timeout(10_000));
      if (error) throw error;
      return required(data, "finalized conversation message ID");
    },
    async fail(jobId, attemptId, workerId, status, message, metadata) {
      const { data, error } = await db.rpc("fail_gateway_job", {
        p_job_id: jobId, p_attempt_id: attemptId, p_worker_id: workerId,
        p_status: status, p_error: message, p_metadata: metadata,
      });
      if (error) throw error;
      return data === true;
    },
    async recordDiagnostics(jobId, attemptId, workerId, sequence, diagnostics, signal) {
      const { data, error } = await db.rpc("record_gateway_diagnostics", { p_job_id: jobId, p_attempt_id: attemptId, p_worker_id: workerId, p_sequence: sequence, p_diagnostics: diagnostics }).abortSignal(signal || AbortSignal.timeout(2000));
      if (error) throw error;
      return typeof data === "string" && ["applied", "unchanged", "stale", "fenced"].includes(data) ? data : "unknown";
    },
    async summarize(job) {
      const [messagesResult, summariesResult] = await Promise.all([
        db.from("messages").select("id,role,content,created_at").eq("owner_id", job.owner_id).eq("sport_id", job.sport_id).order("created_at", { ascending: false }).limit(200),
        db.from("conversation_summaries").select("source_message_ids").eq("owner_id", job.owner_id).eq("sport_id", job.sport_id).order("created_at", { ascending: false }).limit(20),
      ]);
      if (messagesResult.error) throw messagesResult.error;
      if (summariesResult.error) throw summariesResult.error;
      const already = new Set<string>((summariesResult.data || []).flatMap((summary) => summary.source_message_ids || []));
      const candidate = buildSummaryCandidate((messagesResult.data || []) as SummaryMessage[], already);
      if (!candidate) return;
      const inserted = await db.from("conversation_summaries").insert({
        owner_id: job.owner_id, sport_id: job.sport_id, ...candidate,
      });
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
    },
  };
}

export function classifyGatewayFailure(error: unknown): { status: "waiting_quota" | "relogin_required" | "interrupted" | "failed"; message: string; code: string } {
  const actionable = ["insufficient_quota", "quota_exhausted", "billing_hard_limit_reached", "usage_limit_reached", "gateway_unauthorized", "invalid_api_key", "token_expired", "authentication_required"];
  const nested = error instanceof GatewayError ? error.safeDiagnostics?.upstreamErrorCode : undefined;
  const code = nested && actionable.includes(nested) ? nested : error instanceof GatewayError ? error.code.toLowerCase() : "execution_interrupted";
  const httpStatus = error instanceof GatewayError ? error.status : undefined;
  if (["insufficient_quota", "quota_exhausted", "billing_hard_limit_reached", "usage_limit_reached"].includes(code))
    return { status: "waiting_quota", message: "OpenLLMs 사용량 한도가 소진되었습니다. 한도 갱신 후 직접 재시도해 주세요.", code };
  if (["gateway_unauthorized", "invalid_api_key", "token_expired", "authentication_required"].includes(code) || httpStatus === 401)
    return { status: "relogin_required", message: "OpenLLMs 인증이 만료되었거나 거부되었습니다. 연결을 다시 확인해 주세요.", code };
  if (["upstream_interrupted", "upstream_incomplete", "upstream_cancelled", "gateway_protocol_error"].includes(code) || (httpStatus !== undefined && httpStatus >= 500) || !(error instanceof GatewayError))
    return { status: "interrupted", message: "분석 실행이 중단되었습니다. 중복 실행을 피하려면 상태를 확인한 뒤 직접 재시도해 주세요.", code };
  return { status: "failed", message: `분석 실행 실패 (${code}).`, code };
}

export interface WorkerDependencies {
  store: WorkerStore;
  gateway?: (options: GatewayOptions) => Promise<GatewayResult>;
  workerId: string;
  baseUrl: string;
  apiKey: string;
  expectedModel: string;
  upstreamTimeoutSeconds?: number;
  now?: () => Date;
  heartbeatIntervalMs?: number;
  workerInstanceId?: string;
  workerBuildId?: string;
  diagnosticLogger?: DiagnosticLogger;
}

export type WorkerResult = { status: "idle" | "completed" | "failed" | "waiting_quota" | "relogin_required" | "interrupted" | "lease_lost"; jobId?: string };

/** Storage retries never call the model. RPCs independently fence every mutation. */
async function retryStorage<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      const code = String((error as { code?: unknown } | null)?.code || "");
      if (attempt >= 2 || /^(22|23|42|55|PGRST20)/.test(code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

export async function runOnce(deps: WorkerDependencies): Promise<WorkerResult> {
  const upstreamTimeoutSeconds = validateUpstreamTimeoutSeconds(deps.upstreamTimeoutSeconds ?? DEFAULT_UPSTREAM_TIMEOUT_SECONDS);
  const timeoutMs = workerTransportTimeoutMs(upstreamTimeoutSeconds);
  const job = await deps.store.claim(deps.workerId);
  if (!job) return { status: "idle" };
  const ids = [job.id, job.current_attempt_id, deps.workerId] as const;
  const recorder = new DiagnosticRecorder({ jobId: job.id, attemptId: job.current_attempt_id, workerInstanceId: deps.workerInstanceId || randomUUID(), workerBuildId: deps.workerBuildId || "unknown" }, deps.store.recordDiagnostics ? (sequence, envelope, signal) => deps.store.recordDiagnostics!(...ids, sequence, envelope, signal) : undefined, deps.diagnosticLogger);
  let commonPolicy: Pick<CommonPolicyVersion, "id" | "version_date" | "content_hash"> | null = null;
  const fail = async (status: WorkerResult["status"], message: string, metadata: Record<string, unknown>) => {
    const recorded = await deps.store.fail(...ids, status, message, { ...metadata, ...recorder?.metadata(), common_policy: commonPolicy });
    if (!recorded) return { status: "lease_lost" as const, jobId: job.id };
    return { status, jobId: job.id };
  };
  if (!job.current_attempt_id || !job.id) throw new Error("Claimed job lacks ID or attempt ID");
  const validEffort = job.kind === "check_status"
    ? job.effort === "medium"
    : job.effort === "high" || job.effort === "xhigh";
  if (job.model !== deps.expectedModel || job.model !== "gpt-6-astra" || !validEffort)
    return fail("failed", "저장된 모델 또는 추론 설정이 서버 허용값과 다릅니다.", { code: "invalid_job_configuration" });

  let completion: StoredCompletion | null;
  try { completion = await retryStorage(() => deps.store.loadCompletion(...ids)); }
  catch { return fail("failed", "완료 응답 복구 저장소를 확인하지 못해 모델을 실행하지 않았습니다. 데이터베이스 migration과 연결을 확인해 주세요.", { code: "completion_load_failed", execution_started: false }); }
  let context: string;
  try {
    context = completion ? required(completion.input_snapshot.context as string, "original context") : await deps.store.context(job);
    if (completion && (!completion.original_attempt_id || !Number.isFinite(Date.parse(completion.checked_at)) || !completion.result || typeof context !== "string")) throw new Error("Invalid completion checkpoint");
  }
  catch { return fail("failed", "저장된 분석 맥락을 불러오지 못했습니다.", { code: "context_load_failed" }); }

  const originalContext = completion ? String(completion.input_snapshot.original_context ?? context) : context;
  const phaseOneStart = performance.now();
  const preparation = job.kind === "review_results" && !completion ? prepareResultsReview(context) : null;
  if (preparation) context = preparation.context;
  const phaseOneElapsedMs = Math.max(0, Math.floor(performance.now() - phaseOneStart));
  const executionTime = completion ? new Date(String(completion.input_snapshot.execution_time)) : (deps.now || (() => new Date()))();
  const requested = { model: job.model, effort: job.effort, mode: "default_standard" };
  const contextHash = createHash("sha256").update(context).digest("hex");
  let parsedContext: Record<string, unknown> = {};
  try { parsedContext = JSON.parse(context); } catch { /* Legacy test stores may supply plain context; raw input still remains auditable. */ }
  const revision = parsedContext.common_operating_policy as CommonPolicyVersion | null | undefined;
  if (revision) commonPolicy = { id: revision.id, version_date: revision.version_date, content_hash: revision.content_hash };
  const instructions = completion ? String(completion.input_snapshot.instructions) : job.kind === "review_results" ? resultsReviewInstructions(Boolean(commonPolicy)) : instructionsForContext(Boolean(commonPolicy), job.kind === "message");
  let originalParsedContext: Record<string, unknown> = {};
  try { originalParsedContext = JSON.parse(originalContext); } catch { /* Legacy input remains intact. */ }
  const sourceRows = (key: string) => Array.isArray(originalParsedContext[key]) ? originalParsedContext[key] as Record<string, unknown>[] : [];
  const textRequestAudit = (inputContext: string, inputInstructions: string) => {
    const request = buildReviewUsageAudit({ context: inputContext, instructions: inputInstructions }).request;
    return { ...request, total_utf8_bytes: request.context.utf8_bytes + request.instructions.utf8_bytes };
  };
  const reviewInputComparison = job.kind !== "review_results" ? undefined : completion
    ? completion.input_snapshot.review_input_comparison ?? null
    : {
      baseline: textRequestAudit(originalContext, instructionsForContext(Boolean(commonPolicy), false)),
      prepared: textRequestAudit(context, instructions),
      immutable_sources: { assistant_bodies: sourceRows("recent_messages").filter(row => row.role === "assistant").length, user_messages: sourceRows("recent_messages").filter(row => row.role === "user").length, adopted_criteria: sourceRows("adopted_criteria").length },
      bounded_record_counts: Object.fromEntries(["active_events", "relevant_recommendations", "confirmed_bets", "conditional_entry_sources"].map(key => [key, sourceRows(key).length])),
      meaning: "Same source context with full baseline instructions versus prepared packet and review instructions. UTF8 bytes are not provider tokens or account usage; source counts cover available bounded input only.",
    };
  const instructionsHash = createHash("sha256").update(instructions).digest("hex");
  const inputAudit = { attempt_id: completion?.original_attempt_id || job.current_attempt_id, context_sha256: contextHash, instructions_sha256: instructionsHash, common_policy: commonPolicy };
  const reviewPreparation = completion ? completion.input_snapshot.review_preparation ?? { version: 1, elapsed_ms: null, local_only: true }
    : { version: 1, elapsed_ms: phaseOneElapsedMs, local_only: true, ...(preparation?.packet ? { source_audit: { original_context_sha256: preparation.packet.original_context_sha256, source_messages: preparation.packet.source_messages } } : {}) };
  const snapshot = { version: 1, context, ...(job.kind === "review_results" ? { original_context: originalContext, review_input_comparison: reviewInputComparison, review_preparation: reviewPreparation, review_usage: buildReviewUsageAudit({ context, instructions }) } : {}), instructions, requested, execution_time: executionTime.toISOString(), context_sha256: contextHash, instructions_sha256: instructionsHash, common_policy: commonPolicy, source_document_refs: parsedContext.document_sources || [], context_source_ids: Object.fromEntries(["adopted_criteria", "active_events", "recent_messages", "relevant_recommendations", "confirmed_bets", "mistake_notes", "older_summaries"].map(key => [key, sourceRows(key).map(row => row.id).filter(Boolean)])), request_message_id: job.user_message_id, attempt_id: job.current_attempt_id };
  try {
    if (!await deps.store.saveInputSnapshot(...ids, snapshot)) return { status: "lease_lost", jobId: job.id };
  } catch {
    return fail("failed", "분석 입력 스냅샷을 저장하지 못해 실행하지 않았습니다.", { code: "input_snapshot_save_failed", execution_started: false });
  }

  const started = await deps.store.heartbeat(...ids, true);
  if (!started) return { status: "lease_lost", jobId: job.id };
  const checkOwnershipForSave = async () => {
    try {
      const owned = await retryStorage(() => deps.store.heartbeat(...ids, false));
      if (!owned) { recorder.log("lease_lost"); recorder.log("finalize_rejected"); }
      return owned;
    } catch (error) { recorder.log("finalize_rejected"); throw error; }
  };
  const finalizeWithLog = async (save: () => Promise<string>) => {
    try { const saved = await retryStorage(save); recorder!.log("finalize_success"); return saved; }
    catch (error) { recorder!.log("finalize_rejected"); throw error; }
  };
  let leaseLost = false;
  const controller = new AbortController();
  const deadline = performance.now() + upstreamTimeoutSeconds * 1000;
  let deadlineExpired = false;
  const deadlineTimer = setTimeout(() => {
    deadlineExpired = true;
    controller.abort();
    recorder.log("cancellation");
  }, upstreamTimeoutSeconds * 1000);
  const attempts: NonNullable<ReturnType<typeof safeTerminalDiagnostics>>["llms"]["terminal"][] = [];
  let reviewResult: GatewayResult | undefined;
  const recoveryAudit = () => ({ ...(job.kind === "review_results" ? { review_input_comparison: reviewInputComparison, review_usage: buildReviewUsageAudit({ context, instructions, result: reviewResult, attempts: completion ? undefined : attempts, recovered: Boolean(completion) }), results_review: { version: 1, original_context_sha256: createHash("sha256").update(originalContext).digest("hex"), phase_one: { local_only: true, elapsed_ms: completion ? null : phaseOneElapsedMs }, phase_two: { model: job.model, effort: job.effort, tool_choice: "required" } } } : {}), transport_recovery: { attempt_count: attempts.length, recovered: attempts.length === 2 && attempts[1].status === "completed" ? 1 : 0, attempts }, ...recorder!.metadata(), ...(completion ? { completion_recovery: { original_attempt_id: completion.original_attempt_id, original_checked_at: completion.checked_at, recovered_at: (deps.now || (() => new Date()))().toISOString() } } : {}) });
  let lastGatewayError: GatewayError | undefined;
  const timeoutError = (error?: unknown) => {
    const prior = error instanceof GatewayError ? error : lastGatewayError;
    const correlation = prior ? safeInterruptionDiagnostics(prior)?.llms.terminal : undefined;
    return new GatewayError("upstream_interrupted", "Analysis deadline exceeded", undefined, {
      terminalStatus: "interrupted", upstreamErrorCode: "upstream_timeout", transportErrorKind: "deadline_exceeded",
      ...(correlation?.upstream_response_id ? { upstreamResponseId: correlation.upstream_response_id } : {}),
      ...(correlation?.upstream_transport ? { upstreamTransport: correlation.upstream_transport } : {}),
    });
  };
  const checkDeadline = () => {
    if (deadlineExpired || performance.now() >= deadline) { deadlineExpired = true; controller.abort(); throw timeoutError(); }
  };
  let heartbeatPending = Promise.resolve();
  const interval = setInterval(() => {
    heartbeatPending = heartbeatPending.then(async () => {
      try {
        const owned = await deps.store.heartbeat(...ids, false);
        const active = recorder!.transports.at(-1);
        if (active) { active.last_heartbeat_at = new Date().toISOString(); active.heartbeat_outcome = owned ? "owned" : "lost"; }
        if (!owned) { leaseLost = true; controller.abort(); recorder!.log("lease_lost"); recorder!.log("cancellation"); }
      }
      catch { const active = recorder!.transports.at(-1); if (active) { active.last_heartbeat_at = new Date().toISOString(); active.heartbeat_outcome = "check_failed"; } /* No ownership inference. */ }
    });
  }, deps.heartbeatIntervalMs ?? 30_000);

  let result: GatewayResult;
  let checkedAt: Date;
  let completionSaved = Boolean(completion);
  try {
    let transportRecovery: GatewayOptions["transportRecovery"];
    try {
      if (completion) {
        result = completion.result;
        checkedAt = new Date(completion.checked_at);
      } else {
        for (let attempt = 0; ; attempt++) {
          checkDeadline();
          const transport = recorder.start();
          await recorder.checkpoint("transport_started");
          checkDeadline();
          const transportStart = performance.now();
          try {
            result = await (deps.gateway || runGatewayAnalysis)({
              baseUrl: deps.baseUrl, apiKey: deps.apiKey, model: job.model, effort: job.effort as "medium" | "high" | "xhigh",
              context, instructions, toolChoice: job.kind === "message" ? "auto" : "required", timeoutMs, signal: controller.signal,
              correlation: { jobId: job.id, attemptId: job.current_attempt_id, transportAttempt: transport.transport_attempt, requestId: transport.request_id },
              ...(transportRecovery ? { transportRecovery } : {}),
            });
            checkedAt = (deps.now || (() => new Date()))();
            checkDeadline();
            Object.assign(transport, transportDetails({ ...result.safeDiagnostics, upstreamResponseId: result.upstreamResponseId }), { upstream_terminal_status: "completed", ended_at: new Date().toISOString(), elapsed_ms: Math.max(0, Math.floor(performance.now() - transportStart)) });
            if (transport.upstream_response_id === undefined) delete transport.upstream_response_id;
            await recorder.checkpoint("transport_ended");
            const terminal = safeTerminalDiagnostics({ ...result.safeDiagnostics, terminalStatus: "completed", upstreamResponseId: result.upstreamResponseId });
            attempts.push(terminal!.llms.terminal);
            break;
          } catch (caught) {
            if (caught instanceof GatewayError) lastGatewayError = caught;
            const error = deadlineExpired || performance.now() >= deadline ? timeoutError(caught) : caught;
            Object.assign(transport, error instanceof GatewayError ? transportDetails(error.safeDiagnostics) : {}, { ended_at: new Date().toISOString(), elapsed_ms: Math.max(0, Math.floor(performance.now() - transportStart)) });
            if (deadlineExpired) Object.assign(transport, { stage: "worker_control", error_origin: "worker_control", root_cause: "deadline_exceeded", safe_message_code: "deadline_exceeded", cancellation_origin: "worker_deadline" });
            if (leaseLost) Object.assign(transport, { cancellation_origin: "lease_lost" });
            const diagnostic = error instanceof GatewayError ? safeInterruptionDiagnostics(error) : null;
            attempts.push(diagnostic?.llms.terminal || { status: "interrupted" });
            const accountHint = error instanceof GatewayError ? error.recoveryAccountId : undefined;
            const eligible = attempt === 0 && !leaseLost && !controller.signal.aborted && canRecoverTransport(error) && isUUID(accountHint) && accountHint !== "00000000-0000-0000-0000-000000000000";
            transport.retry_decision = eligible ? "retry" : "stop";
            transport.retry_reason = leaseLost ? "lease_lost" : deadlineExpired ? "deadline" : attempt !== 0 ? "attempt_limit" : eligible ? "eligible_transport" : "excluded_error";
            await recorder.checkpoint("transport_ended");
            if (!eligible) throw error;
            // A failed/unknown heartbeat cannot authorize a fresh generation.
            let owned: boolean;
            try { owned = await deps.store.heartbeat(...ids, false); } catch { transport.retry_decision = "stop"; transport.retry_reason = "ownership_check_failed"; throw error; }
            if (!owned) { leaseLost = true; controller.abort(); transport.retry_decision = "stop"; transport.retry_reason = "lease_lost"; recorder.log("lease_lost"); throw error; }
            checkDeadline();
            transportRecovery = { transport: "http", accountId: accountHint! };
            await recorder.checkpoint("retry_planned");
            await recoveryBackoff(controller.signal);
            checkDeadline();
          }
        }
      }
    } catch (caught) {
      const error = deadlineExpired || performance.now() >= deadline ? timeoutError(caught) : caught;
      clearTimeout(deadlineTimer);
      clearInterval(interval);
      await heartbeatPending;
      const recovery = recorder.transports.at(-1);
      if (recovery?.retry_decision === "retry") {
        // Preserve the observed transport error; only the recovery control decision changed.
        if (leaseLost) Object.assign(recovery, { retry_decision: "stop", retry_reason: "lease_lost", cancellation_origin: "lease_lost" });
        else if (deadlineExpired || performance.now() >= deadline) Object.assign(recovery, { retry_decision: "stop", retry_reason: "deadline", cancellation_origin: "worker_deadline" });
      }
      await recorder.checkpoint("finished");
      if (leaseLost) return { status: "lease_lost", jobId: job.id };
      const failure = classifyGatewayFailure(error);
      const diagnostics = error instanceof GatewayError ? safeInterruptionDiagnostics(error) : null;
      const message = failure.status === "interrupted" && diagnostics?.llms.terminal.error?.code === "upstream_timeout"
        ? "설정된 분석 대기시간을 초과해 실행이 중단되었습니다. 부분 응답은 저장하지 않았습니다. 상태를 확인한 뒤 직접 재시도해 주세요."
        : failure.status === "interrupted"
          ? "응답이 중단되어 부분 결과를 저장하지 않았습니다. 상태를 확인한 뒤 직접 재시도해 주세요."
          : failure.message;
      return fail(failure.status, message, {
        code: failure.code, execution_started: true, requested,
        input_snapshot: inputAudit,
        ...(diagnostics ? { llms: diagnostics.llms, upstreamResponseId: diagnostics.llms.terminal.upstream_response_id } : {}),
        ...recoveryAudit(),
      });
    }
    clearTimeout(deadlineTimer);
    await heartbeatPending;
    await recorder.checkpoint("finished");
    if (leaseLost) return { status: "lease_lost", jobId: job.id };
    if (!completion) {
      // No parsing/publishing until the exact terminal answer is durable.
      if (!await retryStorage(() => deps.store.saveCompletion(...ids, { version: 1, result, checked_at: checkedAt.toISOString() }))) return { status: "lease_lost", jobId: job.id };
      completionSaved = true;
    }
    reviewResult = result;
    const terminalAudit = safeTerminalDiagnostics(result.safeDiagnostics);
    const messageIds = new Set<string>((Array.isArray(parsedContext.recent_messages) ? parsedContext.recent_messages as Record<string, unknown>[] : []).map(row => row.id).filter((id): id is string => typeof id === "string"));
    const purpose = extractResponsePurpose(result.text, messageIds);
    const requestNeedsFresh = job.kind === "message" && requiresFreshRequest(String(parsedContext.new_request || ""));
    const freshPurpose = purpose.purpose?.intent === "current_analysis" || purpose.purpose?.intent === "mixed";
    const forbiddenConversationPayload = /```\s*analysis[-_](?:record|coverage|candidates|evaluation)/i.test(purpose.answer);
    if (job.kind === "message" && (!purpose.purpose || (!requestNeedsFresh && !freshPurpose))) {
      const missingFreshEvidence = purpose.purpose?.basis === "fresh_web" && (!result.verified || !result.searched || !result.sources.length);
      const valid = !!purpose.purpose && !forbiddenConversationPayload && !missingFreshEvidence;
      const metadata = {
        terminalStatus: "completed", type: "conversation", result_type: "conversation", requested,
        common_policy: commonPolicy,
        upstream_reported: { model: result.upstreamReportedModel ?? null, reasoning_mode: result.upstreamReportedReasoningMode ?? null, reasoning_effort: result.upstreamReportedReasoningEffort ?? null },
        input_snapshot: inputAudit,
        original_model_response: result.text, checked_at: checkedAt.toISOString(),
        sources: result.sources, searched: result.searched, verified: result.verified,
        usage: result.usage, provider_response_id: result.upstreamResponseId,
        response_purpose: valid ? purpose.purpose : CLARIFICATION_PURPOSE,
        response_purpose_status: valid ? "valid" : "invalid",
        ...(valid ? {} : { response_purpose_failure: forbiddenConversationPayload ? "conversation_analysis_payload" : missingFreshEvidence ? "purpose_fresh_evidence_missing" : purpose.reason }),
        recommendations_persisted: false,
        ...(terminalAudit ? { llms: terminalAudit.llms } : {}),
        ...recoveryAudit(),
      };
      if (!await checkOwnershipForSave()) return { status: "lease_lost", jobId: job.id };
      await finalizeWithLog(() => deps.store.finalizeConversation(...ids, valid ? purpose.answer : CLARIFICATION_CONTENT, metadata, result.upstreamResponseId));
      try { await deps.store.summarize(job); } catch { /* Durable conversation remains saved. */ }
      return { status: "completed", jobId: job.id };
    }
    // A clear request for current facts cannot be downgraded by a model label.
    // Invalid contracts with actual sources still receive a clarification, not records.
    if (job.kind === "message" && !freshPurpose && result.verified && result.searched && result.sources.length) {
      if (!await checkOwnershipForSave()) return { status: "lease_lost", jobId: job.id };
      await finalizeWithLog(() => deps.store.finalizeConversation(...ids, CLARIFICATION_CONTENT, {
        terminalStatus: "completed", type: "conversation", result_type: "conversation", requested,
        common_policy: commonPolicy,
        original_model_response: result.text, sources: result.sources, searched: result.searched, verified: result.verified,
        upstream_reported: { model: result.upstreamReportedModel ?? null, reasoning_mode: result.upstreamReportedReasoningMode ?? null, reasoning_effort: result.upstreamReportedReasoningEffort ?? null },
        input_snapshot: inputAudit,
        checked_at: checkedAt.toISOString(), usage: result.usage, provider_response_id: result.upstreamResponseId,
        response_purpose: CLARIFICATION_PURPOSE, response_purpose_status: "invalid", response_purpose_failure: purpose.reason || "fresh_request_purpose_mismatch", recommendations_persisted: false,
        ...(terminalAudit ? { llms: terminalAudit.llms } : {}),
        ...recoveryAudit(),
      }, result.upstreamResponseId));
      return { status: "completed", jobId: job.id };
    }
    if (job.kind === "review_results") {
      const metadata = {
        terminalStatus: "completed", type: "analysis", result_type: "analysis", requested,
        common_policy: commonPolicy, input_snapshot: inputAudit, original_model_response: result.text,
        checked_at: checkedAt.toISOString(), sources: result.sources, searched: result.searched, verified: result.verified,
        upstream_reported: { model: result.upstreamReportedModel ?? null, reasoning_mode: result.upstreamReportedReasoningMode ?? null, reasoning_effort: result.upstreamReportedReasoningEffort ?? null },
        usage: result.usage, provider_response_id: result.upstreamResponseId, recommendations_persisted: false,
        ...(terminalAudit ? { llms: terminalAudit.llms } : {}), ...recoveryAudit(),
      };
      if (!result.verified || !result.searched || !result.sources.length || !result.text.trim()) {
        return fail("failed", "검색 출처나 완료된 회고를 확인하지 못해 게시하지 않았습니다. 원문 응답은 복구용으로 보존했습니다.", { ...metadata, code: "source_verification_failed", source_count: result.sources.length });
      }
      const checkedLocal = new Intl.DateTimeFormat("ko-KR", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(checkedAt);
      const content = `${result.text}\n\n---\n자료 확인 시각: ${checkedLocal} (America/New_York)\n출처: ${result.sources.map(source => `[${source.title}](${source.url})`).join(" · ")}\n미확인 사항: 본문에 명시한 사항 참조.`;
      if (!await checkOwnershipForSave()) return { status: "lease_lost", jobId: job.id };
      await finalizeWithLog(() => deps.store.finalize(...ids, content, metadata, result.upstreamResponseId));
      try { await deps.store.summarize(job); } catch { /* Durable review remains saved. */ }
      return { status: "completed", jobId: job.id };
    }
    const expectedSport = String(parsedContext.sport || "");
    const expectedScope = (parsedContext.analysis_scope || resolveAnalysisScope({ sport: expectedSport, request: String(parsedContext.new_request || ""), kind: job.kind, now: executionTime }).scope) as AnalysisScope;
    const analysisResponse = stripAnalysisCandidateBlocks(purpose.purpose ? purpose.answer : result.text);
    // Hidden evaluation JSON must never supply visible-body coverage identity or record citations.
    const evaluation = extractEvaluationReport(analysisResponse, { sport: expectedSport, dateEt: expectedScope.date_et, coverageReport: null, sources: result.sources });
    const coverage = extractCoverageReport(evaluation.answer, expectedScope, result.sources);
    const evaluationOptions = { sport: expectedSport, dateEt: expectedScope.date_et, coverageReport: coverage.report, sources: result.sources };
    const extracted = extractAnalysisRecord(coverage.answer, expectedSport, result.sources, checkedAt, { commonPolicyAdopted: Boolean(commonPolicy), scopeDate: expectedScope.date_et, originalRawSha256: createHash("sha256").update(result.text).digest("hex") });
    const evaluationDiagnostic = extractEvaluationReport(analysisResponse, {
      ...evaluationOptions, record: extracted.record,
      canonicalEventKeys: Object.fromEntries((coverage.report?.inventory || []).flatMap(event => {
        // Match exact original identity using the admitted native event's actual source URL.
        // Coverage may cite an official schedule while the native record cites a game page.
        const matching = extracted.record?.events.filter(native => native.event_key === event.event_key || (event.event_key.endsWith(":src") && native.event_key === sourcedEventKey(event.event_key, native.source_url)));
        return matching?.length === 1 ? [[event.event_key, matching[0].event_key]] : [];
      })),
    });
    const request = String(parsedContext.new_request || "");
    const valuationIntent = /분석|평가|가격|배당|가치|매치업|analysis|evaluat|price|odds|value|matchup/i.test(request);
    const explicitStatusOnly = /시작했|시작됐|시작되었|게시|발표|나왔|started|posted|published/i.test(request);
    const finalRecheck = job.kind === "recheck_lineup" || parsedContext.scope_workflow === "recheck_lineup" || isRecheckRequest(request);
    const statusRequest = job.kind === "check_status" || /라인업|출전|일정|상태|status|lineups?|schedule|injur/i.test(request) || explicitStatusOnly;
    const evaluationApplicable = job.kind !== "review_results" && (valuationIntent || (finalRecheck && !explicitStatusOnly) || !statusRequest);
    const metadata = {
      terminalStatus: "completed",
      type: "analysis", result_type: "analysis",
      common_policy: commonPolicy,
      ...(job.kind === "message" && purpose.purpose ? { response_purpose: purpose.purpose, response_purpose_status: "valid" } : {}),
      requested,
      upstream_reported: { model: result.upstreamReportedModel ?? null, reasoning_mode: result.upstreamReportedReasoningMode ?? null, reasoning_effort: result.upstreamReportedReasoningEffort ?? null },
      input_snapshot: inputAudit,
      original_model_response: result.text,
      ...(evaluationApplicable ? { evaluation_validation: evaluationDiagnostic.validation, ...(evaluationDiagnostic.report ? { evaluation_report: evaluationDiagnostic.report } : {}), ...(evaluationDiagnostic.quarantinedMarkets.length ? { evaluation_quarantined_markets: evaluationDiagnostic.quarantinedMarkets } : {}) } : {}),
      coverage: coverage.validation,
      ...(coverage.report ? { coverage_report: coverage.report } : {}),
      checked_at: checkedAt.toISOString(), sources: result.sources, searched: result.searched,
      verified: result.verified, unknowns: result.verified ? [] : ["검색 출처나 완료된 응답이 확인되지 않았습니다."],
      usage: result.usage, provider_response_id: result.upstreamResponseId,
      extraction_status: extracted.status,
      ...(extracted.record_admission ? { record_admission: extracted.record_admission } : {}),
      ...(extracted.status === "incomplete" ? {
        extraction_failure: extracted.failure,
        original_model_response: result.text,
      } : {}),
      ...(extracted.record ? { analysis_record: extracted.record } : {}),
      ...(extracted.recommendation_key_corrections?.length ? { recommendation_key_corrections: extracted.recommendation_key_corrections } : {}),
      recommendations_persisted: Boolean(extracted.record?.recommendations.length),
      ...(terminalAudit ? { llms: terminalAudit.llms } : {}),
      ...recoveryAudit(),
    };
    if (!result.verified || !result.searched || !result.sources.length || !result.text.trim()) {
      const message = !result.searched
        ? "검색을 완료하지 못해 분석 결과를 게시하지 않았습니다. 완료 응답은 감사용으로 보존했습니다. 연결 또는 검색 상태를 확인한 뒤 새 분석을 요청해 주세요."
        : result.sources.length === 0
          ? "응답은 완료됐지만 검증 가능한 출처가 없어 분석 결과를 게시하지 않았습니다. 완료 응답은 감사용으로 보존했습니다. 출처를 확인한 뒤 새 분석을 요청해 주세요."
          : "응답은 완료됐지만 분석 내용을 검증할 수 없어 결과를 게시하지 않았습니다. 완료 응답은 감사용으로 보존했습니다. 내용을 확인한 뒤 새 분석을 요청해 주세요.";
      return fail("failed", message, {
        ...metadata,
        code: "source_verification_failed",
        source_count: result.sources.length,
        upstreamResponseId: result.upstreamResponseId,
      });
    }
    const checkedLocal = new Intl.DateTimeFormat("ko-KR", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(checkedAt);
    const answer = extracted.status === "incomplete" ? coverage.answer : extracted.answer;
    const coverageReasons = [...new Set(coverage.validation.reasons.map(formatCoverageReason))].slice(0, 8).join(" ");
    const extractionNotice = extracted.status === "incomplete"
      ? "구조화 기록 추출 미완료; 분석 원문만 저장됨.\n\n"
      : extracted.status === "partial"
        ? `출처 자격 검증에서 제외된 ${extracted.record_admission.rejected_events.length}개 경기 행과 연결된 ${extracted.record_admission.rejected_recommendations.length}개 추천 행은 저장하지 않았습니다. 나머지 적격 기록과 본문 분석은 보존했습니다.\n\n`
        : "";
    const content = `${answer}\n\n전체 일정 coverage: ${coverage.validation.status === "incomplete" ? "미완료" : "미검증"} (${coverage.validation.assessed_count}/${coverage.validation.listed_count} 경기 목록 처리; 독립 일정 검증 미지원).\n${coverageReasons}\n\n${extractionNotice}---\n자료 확인 시각: ${checkedLocal} (America/New_York)\n출처: ${result.sources.map((source) => `[${source.title}](${source.url})`).join(" · ")}\n미확인 사항: 본문에 명시한 사항 참조.`;
    // A successful refresh confirms ownership after transient storage outages.
    // Finalization still fences the attempt atomically if ownership changes afterward.
    if (!await checkOwnershipForSave()) return { status: "lease_lost", jobId: job.id };
    await finalizeWithLog(() => deps.store.finalize(...ids, content, metadata, result.upstreamResponseId));
    try { await deps.store.summarize(job); } catch { /* Completed analysis remains durable; summary can catch up on the next job. */ }
    return { status: "completed", jobId: job.id };
  } catch (error) {
    if (leaseLost || String((error as { code?: unknown } | null)?.code) === "55000") return { status: "lease_lost", jobId: job.id };
    return fail("interrupted", completionSaved
      ? "모델 응답은 보존되었지만 게시를 완료하지 못했습니다. 재시도하면 모델을 다시 호출하지 않고 저장된 응답을 복구합니다."
      : "모델 응답 완료 후 복구용 저장에 실패했습니다. 결과가 보존되었는지 확인한 뒤 재시도해 주세요.", {
      code: completionSaved ? "completion_finalize_failed" : "completion_checkpoint_failed", execution_started: true, completion_saved: completionSaved, input_snapshot: inputAudit, ...recoveryAudit(),
    });
  } finally {
    clearTimeout(deadlineTimer);
    clearInterval(interval);
    await heartbeatPending;
  }
}

const safeTerminalStatuses = new Set(["completed", "incomplete", "failed", "cancelled", "interrupted"]);
const safeInterruptionCodes = new Set([
  "insufficient_quota", "quota_exhausted", "billing_hard_limit_reached", "usage_limit_reached",
  "gateway_unauthorized", "invalid_api_key", "token_expired", "authentication_required",
  "upstream_timeout", "upstream_transport_error", "upstream_eof", "max_output_tokens", "content_filter",
  "server_error", "rate_limit_exceeded", "invalid_prompt", "cancelled", "upstream_error",
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
function safeInterruptionDiagnostics(error: GatewayError): { llms: { terminal: {
  status: string; error?: { code: string }; upstream_response_id?: string; http_status?: number;
  transport_error_kind?: string; request_context_cancelled?: boolean; upstream_elapsed_ms?: number;
  last_event_age_ms?: number; event_count?: number; upstream_http_protocol?: "HTTP/1.1" | "HTTP/2.0"; request_id?: string;
  upstream_transport?: "http" | "ws";
  websocket_close_code?: number; websocket_message_too_big?: boolean; websocket_protocol_error?: boolean; last_event_type?: GatewaySafeEventType;
} } } | null {
  return safeTerminalDiagnostics(error.safeDiagnostics, error.code === "upstream_interrupted" ? "upstream_eof" : undefined);
}

function safeTerminalDiagnostics(source: GatewaySafeDiagnostics | undefined, fallbackCode?: string): { llms: { terminal: {
  status: string; error?: { code: string }; upstream_response_id?: string; http_status?: number;
  transport_error_kind?: string; request_context_cancelled?: boolean; upstream_elapsed_ms?: number;
  last_event_age_ms?: number; event_count?: number; upstream_http_protocol?: "HTTP/1.1" | "HTTP/2.0"; request_id?: string;
  upstream_transport?: "http" | "ws";
  websocket_close_code?: number; websocket_message_too_big?: boolean; websocket_protocol_error?: boolean; last_event_type?: GatewaySafeEventType;
} } } | null {
  const terminal = source?.terminalStatus && safeTerminalStatuses.has(source.terminalStatus) ? source.terminalStatus : "interrupted";
  const upstreamCode = source?.upstreamErrorCode && safeInterruptionCodes.has(source.upstreamErrorCode)
    ? source.upstreamErrorCode
    : fallbackCode && safeInterruptionCodes.has(fallbackCode) ? fallbackCode : undefined;
  const responseId = typeof source?.upstreamResponseId === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(source.upstreamResponseId)
    ? source.upstreamResponseId
    : undefined;
  const httpStatus = typeof source?.httpStatus === "number" && Number.isInteger(source.httpStatus) && source.httpStatus >= 100 && source.httpStatus <= 599
    ? source.httpStatus
    : undefined;
  const transportErrorKind = typeof source?.transportErrorKind === "string" && safeTransportErrorKinds.has(source.transportErrorKind)
    ? source.transportErrorKind
    : undefined;
  const requestContextCancelled = typeof source?.requestContextCancelled === "boolean" ? source.requestContextCancelled : undefined;
  const upstreamElapsedMs = typeof source?.upstreamElapsedMs === "number" && Number.isInteger(source.upstreamElapsedMs) && source.upstreamElapsedMs >= 0 && source.upstreamElapsedMs <= 86_400_000
    ? source.upstreamElapsedMs
    : undefined;
  const lastEventAgeMs = typeof source?.lastEventAgeMs === "number" && Number.isInteger(source.lastEventAgeMs) && source.lastEventAgeMs >= 0 && source.lastEventAgeMs <= 86_400_000
    ? source.lastEventAgeMs
    : undefined;
  const eventCount = typeof source?.eventCount === "number" && Number.isInteger(source.eventCount) && source.eventCount >= 0 && source.eventCount <= 1_000_000
    ? source.eventCount
    : undefined;
  const upstreamHttpProtocol = source?.upstreamHttpProtocol === "HTTP/1.1" || source?.upstreamHttpProtocol === "HTTP/2.0"
    ? source.upstreamHttpProtocol
    : undefined;
  const requestId = typeof source?.requestId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(source.requestId)
    ? source.requestId
    : undefined;
  const upstreamTransport = source?.upstreamTransport === "http" || source?.upstreamTransport === "ws"
    ? source.upstreamTransport
    : undefined;
  const websocketCloseCode = typeof source?.websocketCloseCode === "number" && Number.isInteger(source.websocketCloseCode) && source.websocketCloseCode >= 1000 && source.websocketCloseCode <= 4999
    ? source.websocketCloseCode
    : undefined;
  const websocketMessageTooBig = typeof source?.websocketMessageTooBig === "boolean" ? source.websocketMessageTooBig : undefined;
  const websocketProtocolError = typeof source?.websocketProtocolError === "boolean" ? source.websocketProtocolError : undefined;
  const lastEventType = typeof source?.lastEventType === "string" && safeUpstreamEventTypes.has(source.lastEventType)
    ? source.lastEventType
    : undefined;
  if (!source && !upstreamCode && !responseId && !httpStatus) return null;
  return { llms: { terminal: {
    status: terminal,
    ...(upstreamCode ? { error: { code: upstreamCode } } : {}),
    ...(responseId ? { upstream_response_id: responseId } : {}),
    ...(httpStatus ? { http_status: httpStatus } : {}),
    ...(transportErrorKind ? { transport_error_kind: transportErrorKind } : {}),
    ...(requestContextCancelled !== undefined ? { request_context_cancelled: requestContextCancelled } : {}),
    ...(upstreamElapsedMs !== undefined ? { upstream_elapsed_ms: upstreamElapsedMs } : {}),
    ...(lastEventAgeMs !== undefined ? { last_event_age_ms: lastEventAgeMs } : {}),
    ...(eventCount !== undefined ? { event_count: eventCount } : {}),
    ...(upstreamHttpProtocol ? { upstream_http_protocol: upstreamHttpProtocol } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    ...(upstreamTransport ? { upstream_transport: upstreamTransport } : {}),
    ...(websocketCloseCode !== undefined ? { websocket_close_code: websocketCloseCode } : {}),
    ...(websocketMessageTooBig !== undefined ? { websocket_message_too_big: websocketMessageTooBig } : {}),
    ...(websocketProtocolError !== undefined ? { websocket_protocol_error: websocketProtocolError } : {}),
    ...(lastEventType ? { last_event_type: lastEventType } : {}),
  } } };
}

// Recovery starts a fresh read-only generation; a gateway call itself never replays.
function canRecoverTransport(error: unknown): boolean {
  if (!(error instanceof GatewayError) || error.code !== "upstream_interrupted") return false;
  const d = error.safeDiagnostics;
  if (d?.terminalStatus !== "interrupted" || d.upstreamErrorCode !== "upstream_transport_error" || d.upstreamTransport !== "ws"
    || d.requestContextCancelled === true || d.websocketMessageTooBig === true || d.websocketProtocolError === true) return false;
  if (d.transportErrorKind && ["deadline_exceeded", "context_cancelled", "scanner_token_too_long"].includes(d.transportErrorKind)) return false;
  if (d.websocketCloseCode !== undefined) return [1011, 1012, 1013].includes(d.websocketCloseCode);
  return d.transportErrorKind === "unexpected_eof" || d.transportErrorKind === "connection_reset";
}

function recoveryBackoff(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("Recovery aborted")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 250);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

function transportDetails(source: GatewaySafeDiagnostics | undefined): SafeTransportDetails {
  const terminal = safeTerminalDiagnostics(source)?.llms.terminal;
  const details: SafeTransportDetails = source?.diagnostics && validateDetails(source.diagnostics) ? { ...source.diagnostics } : {};
  if (!terminal) return details;
  if (terminal.upstream_response_id) details.upstream_response_id = terminal.upstream_response_id;
  if (terminal.upstream_transport) details.upstream_transport = terminal.upstream_transport;
  if (terminal.upstream_http_protocol) details.upstream_http_protocol = terminal.upstream_http_protocol;
  if (terminal.last_event_type) details.last_event_type = terminal.last_event_type;
  if (terminal.event_count !== undefined) details.event_count = terminal.event_count;
  if (terminal.last_event_age_ms !== undefined) details.last_event_age_ms = terminal.last_event_age_ms;
  if (terminal.websocket_close_code !== undefined) details.websocket_close_code = terminal.websocket_close_code;
  if (terminal.websocket_message_too_big !== undefined) details.websocket_message_too_big = terminal.websocket_message_too_big;
  if (terminal.websocket_protocol_error !== undefined) details.websocket_protocol_error = terminal.websocket_protocol_error;
  if (!details.root_cause && terminal.transport_error_kind) details.root_cause = ROOT_CAUSES.includes(terminal.transport_error_kind as RootCause) ? terminal.transport_error_kind as RootCause : "unknown";
  if (details.root_cause && !details.safe_message_code) details.safe_message_code = details.root_cause;
  return details;
}
