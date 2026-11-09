import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  calls: [] as { table: string; columns: string; filters: [string, ...unknown[]][]; limit?: number }[],
  sports: [{ id: "sport-1", slug: "mlb" }],
  recentJobs: [{
    id: "completed-1",
    status: "completed",
    created_at: "2026-09-27T11:00:00Z",
    updated_at: "2026-09-27T11:02:00Z",
    error: "must not be selected",
  }],
  activeJobs: [{
    id: "queued-1",
    status: "queued",
    created_at: "2026-09-27T11:03:00Z",
    updated_at: "2026-09-27T11:03:00Z",
  }],
}));

vi.mock("@/lib/supabase/server", () => ({
  requireOwner: mocks.requireOwner,
  apiError: (error: unknown) => error instanceof Response
    ? error
    : Response.json({ error: "Unexpected error" }, { status: 500 }),
}));
vi.mock("@/lib/import/validation", () => ({
  SPORT_SLUGS: ["mlb", "nfl", "cfb", "soccer", "tennis", "nba", "wnba", "nhl"],
}));

function queryResult(table: string, options: { count?: number; data?: unknown[] } = {}) {
  const query: Record<string, (...args: unknown[]) => unknown> = {};
  const call = { table, columns: "", filters: [] as [string, ...unknown[]][], limit: undefined as number | undefined };
  mocks.calls.push(call);
  const resultData = () => (options.data || []).map((row) => {
    if (!row || typeof row !== "object") return row;
    const record = row as Record<string, unknown>;
    return Object.fromEntries(call.columns.split(",").map((column) => [column, record[column]]));
  });
  query.select = (...args) => {
    call.columns = String(args[0]);
    return query;
  };
  query.eq = (...args) => {
    call.filters.push(["eq", ...args]);
    return query;
  };
  query.in = (...args) => {
    call.filters.push(["in", ...args]);
    return query;
  };
  query.order = () => query;
  query.limit = (...args) => {
    call.limit = Number(args[0]);
    return Promise.resolve({
      data: resultData(),
      count: options.count ?? null,
      error: null,
    });
  };
  query.then = (resolve, reject) => Promise.resolve({
    data: resultData(),
    count: options.count ?? null,
    error: null,
  }).then(resolve as (value: unknown) => unknown, reject as (reason: unknown) => never);
  return query;
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.requireOwner.mockReset().mockResolvedValue({
    user: { id: "owner-1" },
    supabase: {
      from: (table: string) => table === "sports"
        ? queryResult("sports", { data: mocks.sports })
        : queryResult("analysis_jobs", {
            data: mocks.calls.filter((call) => call.table === "analysis_jobs").length % 2
              ? mocks.activeJobs
              : mocks.recentJobs,
            count: 1,
          }),
    },
  });
});

describe("GET /api/jobs/overview", () => {
  it("returns bounded metadata for each owned sport and keeps active counts separate", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.jobs.mlb.map((job: { id: string }) => job.id)).toEqual(["queued-1", "completed-1"]);
    expect(body.activeCounts.mlb).toBe(1);
    expect(body.jobs.mlb[1]).not.toHaveProperty("error");
    const jobCalls = mocks.calls.filter((call) => call.table === "analysis_jobs");
    expect(jobCalls).toHaveLength(2);
    for (const call of jobCalls) {
      expect(call.columns).toBe("id,status,created_at,updated_at,attempt,dismissed_attempt,result_type");
      expect(call.filters).toContainEqual(["eq", "owner_id", "owner-1"]);
      expect(call.filters).toContainEqual(["eq", "sport_id", "sport-1"]);
      expect(call.limit).toBeLessThanOrEqual(100);
    }
  });

  it("returns the owner guard response without querying data", async () => {
    mocks.requireOwner.mockRejectedValue(new Response("Sign in required", { status: 401 }));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.calls).toHaveLength(0);
  });
});
