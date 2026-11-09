import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  job: { id: "job-1", status: "interrupted", attempt: 2, dismissed_attempt: null as number | null },
  calls: [] as { table: string; operation: string; filters: [string, ...unknown[]][]; values?: unknown }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  requireOwner: mocks.requireOwner,
  apiError: (error: unknown) => error instanceof Response
    ? error
    : Response.json({ error: "Unexpected error" }, { status: 500 }),
}));

function makeQuery(table: string) {
  const call = { table, operation: "", filters: [] as [string, ...unknown[]][], values: undefined as unknown };
  mocks.calls.push(call);
  const query: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["select", "eq", "in"] as const) {
    query[method] = (...args) => {
      if (method === "eq" || method === "in") call.filters.push([method, ...args]);
      return query;
    };
  }
  query.update = (...args) => {
    call.operation = "update";
    call.values = args[0];
    return query;
  };
  query.maybeSingle = () => Promise.resolve({
    data: table === "analysis_jobs"
      ? call.operation === "update"
        ? { ...mocks.job, dismissed_attempt: mocks.job.attempt }
        : mocks.job
      : null,
    error: null,
  });
  return query;
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.job = { id: "job-1", status: "interrupted", attempt: 2, dismissed_attempt: null };
  mocks.requireOwner.mockReset().mockResolvedValue({
    user: { id: "owner-1" },
    supabase: { from: makeQuery },
  });
});

describe("POST /api/jobs/[id]/dismiss", () => {
  it("dismisses only the current failed attempt for its owner", async () => {
    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "job-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.job.dismissed_attempt).toBe(2);
    const [lookup, update] = mocks.calls;
    expect(lookup.filters).toContainEqual(["eq", "owner_id", "owner-1"]);
    expect(update.values).toEqual({ dismissed_attempt: 2 });
    expect(update.filters).toContainEqual(["eq", "owner_id", "owner-1"]);
    expect(update.filters).toContainEqual(["eq", "attempt", 2]);
    expect(update.filters).toContainEqual(["in", "status", ["failed", "interrupted", "waiting_quota", "relogin_required"]]);
  });

  it("does not allow dismissing a nonfailed job", async () => {
    mocks.job.status = "completed";

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "job-1" }),
    });

    expect(response.status).toBe(409);
    expect(mocks.calls).toHaveLength(1);
  });

  it("returns the owner guard response without querying jobs", async () => {
    mocks.requireOwner.mockRejectedValue(new Response("Sign in required", { status: 401 }));

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "job-1" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.calls).toHaveLength(0);
  });
});
