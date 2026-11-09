import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { createSupabaseWorkerStore, runOnce } from "../src/lib/analysis/worker";
import { parseAnalysisConcurrency, runWorkerPool } from "../src/lib/analysis/pool";
import { isUUID, safeBuildId } from "../src/lib/analysis/diagnostics";
import { parseUpstreamTimeoutSeconds } from "../src/lib/analysis/timeout";

loadEnvConfig(process.cwd());

function setting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const baseUrl = setting("OPENLLMS_BASE_URL");
if (!/^https?:\/\/[^/]+(?:\/[^/?#]+)*\/r\/[^/?#]+\/v1\/?$/.test(baseUrl))
  throw new Error("OPENLLMS_BASE_URL must end with /r/<slug>/v1");
const apiKey = setting("OPENLLMS_API_KEY");
const supabaseUrl = setting("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = setting("SUPABASE_SERVICE_ROLE_KEY");
const expectedModel = process.env.OPENLLMS_MODEL?.trim() || "gpt-6-astra";
if (expectedModel !== "gpt-6-astra") throw new Error("OPENLLMS_MODEL must be gpt-6-astra");
const upstreamTimeoutSeconds = parseUpstreamTimeoutSeconds(process.env.OPENLLMS_UPSTREAM_TIMEOUT_SECONDS);

const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  // Supabase initializes Realtime even though this worker only uses PostgREST.
  // Node 20 has no native WebSocket; provide a transport to prevent startup failure.
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
});
const store = createSupabaseWorkerStore(db);
const workerInstanceId = randomUUID();
const workerBuildId = safeBuildId(process.env.SPORTSDESK_WORKER_BUILD_ID || process.env.SOURCE_VERSION);
const deploymentId = safeBuildId(process.env.SPORTSDESK_DEPLOYMENT_ID);
const workerId = `${hostname()}:${process.pid}:${workerInstanceId}`;
const log = (record: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ service: "analysis-worker", worker_build_id: workerBuildId, worker_instance_id: workerInstanceId, deployment_id: deploymentId, ...record })}\n`);
const concurrency = parseAnalysisConcurrency(process.env.ANALYSIS_CONCURRENCY);
const shutdown = new AbortController();
process.on("SIGINT", () => { log({ event: "shutdown_requested", signal: "SIGINT" }); shutdown.abort(); });
process.on("SIGTERM", () => { log({ event: "shutdown_requested", signal: "SIGTERM" }); shutdown.abort(); });

async function main() {
  log({ event: "worker_started", slots: concurrency });
  await runWorkerPool({
    concurrency, workerId, signal: shutdown.signal,
    run: (slotWorkerId) => runOnce({ store, workerId: slotWorkerId, baseUrl, apiKey, expectedModel, upstreamTimeoutSeconds, workerInstanceId, workerBuildId, diagnosticLogger: log }),
    onResult: (result) => {
      // Log only job state and ID. Never print credentials, request context, or provider error bodies.
      if (result.status !== "idle") log({ event: "job_result", status: result.status, ...(isUUID(result.jobId) ? { job_id: result.jobId } : {}) });
    },
    onError: () => {
      log({ event: "storage_operation_failed" });
    },
  });
  log({ event: "worker_stopped" });
}

void main().catch(() => { log({ event: "worker_failed" }); process.exitCode = 1; });
