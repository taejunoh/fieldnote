import { describe, expect, it, vi } from "vitest";
import { parseAnalysisConcurrency, runWorkerPool } from "./pool";
import type { WorkerResult } from "./worker";

describe("analysis worker pool", () => {
  it("rejects unsafe concurrency settings", () => {
    expect(parseAnalysisConcurrency(undefined)).toBe(2);
    expect(parseAnalysisConcurrency("4")).toBe(4);
    for (const value of ["0", "5", "1.5", "2workers", "-1"])
      expect(() => parseAnalysisConcurrency(value)).toThrow("ANALYSIS_CONCURRENCY");
  });

  it("starts only the configured slots and drains both active calls on shutdown", async () => {
    const controller = new AbortController();
    const active = new Map<string, (result: WorkerResult) => void>();
    const starts: string[] = [];
    const finished: string[] = [];
    let drained = false;
    const pool = runWorkerPool({
      concurrency: 2, workerId: "process-1", signal: controller.signal,
      run: (workerId) => new Promise((resolve) => { starts.push(workerId); active.set(workerId, resolve); }),
      onResult: (result) => { finished.push(result.jobId!); },
    }).then(() => { drained = true; });
    expect(starts).toEqual(["process-1:slot-1", "process-1:slot-2"]);
    controller.abort();
    active.get(starts[0])!({ status: "completed", jobId: "first" });
    await Promise.resolve();
    expect(drained).toBe(false);
    active.get(starts[1])!({ status: "completed", jobId: "second" });
    await pool;
    expect(finished).toEqual(["first", "second"]);
    expect(starts).toHaveLength(2);
    expect(drained).toBe(true);
  });

  it("lets a free slot take another job while the other slot is occupied", async () => {
    const controller = new AbortController();
    let releaseSlow!: (result: WorkerResult) => void;
    const progress: string[] = [];
    const pool = runWorkerPool({
      concurrency: 2, workerId: "process-1", signal: controller.signal,
      run: async (workerId) => {
        if (workerId.endsWith("slot-1")) return new Promise((resolve) => { releaseSlow = resolve; });
        progress.push("fast completed");
        if (progress.length === 2) controller.abort();
        return { status: "completed", jobId: `fast-${progress.length}` };
      },
    });
    await vi.waitFor(() => expect(progress).toHaveLength(2));
    releaseSlow({ status: "completed", jobId: "slow" });
    await pool;
  });

  it("wakes an idle slot immediately when stopping and does not claim again", async () => {
    const controller = new AbortController();
    let claims = 0;
    const pool = runWorkerPool({
      concurrency: 1, workerId: "process-1", signal: controller.signal,
      run: async () => { claims++; return { status: "idle" }; },
    });
    await Promise.resolve();
    controller.abort();
    await pool;
    expect(claims).toBe(1);
  });
});
