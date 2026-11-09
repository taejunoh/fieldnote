import { describe, expect, it, vi } from "vitest";
import { runOnce, type ClaimedJob, type WorkerStore } from "./worker";
import type { GatewayResult } from "./gateway";

const result: GatewayResult = { text: "", sources: [], searched: false, verified: false, upstreamResponseId: null, usage: { inputTokens: 0, outputTokens: 0 } };

function store(job: ClaimedJob): WorkerStore {
  return {
    claim: vi.fn().mockResolvedValue(job), heartbeat: vi.fn().mockResolvedValue(true),
    context: vi.fn().mockResolvedValue(JSON.stringify({ sport: "nba", new_request: "status check" })),
    saveInputSnapshot: vi.fn().mockResolvedValue(true), loadCompletion: vi.fn().mockResolvedValue(null),
    saveCompletion: vi.fn().mockResolvedValue(true), finalize: vi.fn().mockResolvedValue("assistant-1"),
    finalizeConversation: vi.fn().mockResolvedValue("assistant-1"), fail: vi.fn().mockResolvedValue(true),
    summarize: vi.fn().mockResolvedValue(undefined),
  };
}

async function execute(kind: string, effort: string) {
  const job: ClaimedJob = { id: "job-1", owner_id: "owner-1", sport_id: "sport-1", user_message_id: "message-1", kind, model: "gpt-6-astra", effort, current_attempt_id: "attempt-1" };
  const db = store(job); const gateway = vi.fn().mockResolvedValue(result);
  const status = await runOnce({ store: db, gateway, workerId: "worker-1", baseUrl: "https://gateway.test/v1", apiKey: "not-used", expectedModel: "gpt-6-astra" });
  return { db, gateway, status };
}

describe("worker reasoning-effort request gate", () => {
  it.each([["analyze_today", "high"], ["analyze_today", "xhigh"], ["recheck_lineup", "high"], ["review_results", "high"], ["message", "high"], ["check_status", "medium"]])("accepts queued %s/%s jobs", async (kind, effort) => {
    const output = await execute(kind, effort);
    expect(output.gateway).toHaveBeenCalledOnce();
    expect(output.gateway).toHaveBeenCalledWith(expect.objectContaining({ effort }));
  });

  it.each([["analyze_today", "low"], ["recheck_lineup", "medium"], ["review_results", "low"], ["message", "medium"], ["check_status", "high"]])("rejects unsupported queued %s/%s jobs before gateway execution", async (kind, effort) => {
    const output = await execute(kind, effort);
    expect(output.gateway).not.toHaveBeenCalled();
    expect(output.db.fail).toHaveBeenCalledWith("job-1", "attempt-1", "worker-1", "failed", expect.any(String), expect.objectContaining({ code: "invalid_job_configuration" }));
  });
});
