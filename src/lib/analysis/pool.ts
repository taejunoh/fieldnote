import type { WorkerResult } from "./worker";

export function parseAnalysisConcurrency(value: string | undefined): number {
  const concurrency = value?.trim() || "2";
  if (!/^[1-4]$/.test(concurrency)) throw new Error("ANALYSIS_CONCURRENCY must be an integer from 1 to 4");
  return Number(concurrency);
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export async function runWorkerPool(options: {
  concurrency: number;
  workerId: string;
  signal: AbortSignal;
  run: (workerId: string) => Promise<WorkerResult>;
  onResult?: (result: WorkerResult) => void;
  onError?: () => void;
}): Promise<void> {
  parseAnalysisConcurrency(String(options.concurrency));
  await Promise.all(Array.from({ length: options.concurrency }, async (_, slot) => {
    const workerId = `${options.workerId}:slot-${slot + 1}`;
    while (!options.signal.aborted) {
      try {
        // Shutdown stops polling. Active claims, heartbeats, and gateway calls drain normally.
        const result = await options.run(workerId);
        options.onResult?.(result);
        if (result.status === "idle") await pause(3000, options.signal);
      } catch {
        options.onError?.();
        await pause(5000, options.signal);
      }
    }
  }));
}
