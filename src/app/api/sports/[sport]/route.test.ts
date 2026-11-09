import { entryFixture, trustedEntryAttempt } from "../../../../lib/records/conditional-entry.fixture";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { GET } from "./route";

const auth = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }));
vi.mock("@/lib/supabase/server", () => ({
  requireOwner: async () => ({ supabase: auth.client, user: { id: "owner" } }),
  apiError: (error: unknown) => Response.json({ error: String(error) }, { status: 500 }),
}));
vi.mock("@/lib/analysis/data", () => ({
  isSportSlug: (slug: string) => slug === "mlb",
  getOrCreateSport: async () => ({ id: "sport", slug: "mlb" }),
}));

const recoveryProjection = vi.hoisted(() => ({ project: vi.fn() }));
vi.mock("@/lib/record-recovery", () => ({ recordRecoveryFromMetadata: recoveryProjection.project }));

const sourceJobQueries:string[]=[];
let sourceAttempts:Record<string,unknown>[]=[];
const sourceAttemptQueries:string[]=[];
type Job = { id: string; status: string; created_at: string; owner_id: string; sport_id: string };
type EventRow = { id: string; updated_at: string; owner_id: string; sport_id: string };
type BetRow = { id: string; created_at: string; owner_id: string; sport_id: string };
function job(id: string, status: string, day: number): Job {
  return { id, status, created_at: new Date(Date.UTC(2026, 0, day)).toISOString(), owner_id: "owner", sport_id: "sport" };
}

// Keep the real PostgREST query builder; replace only the remote database response.
function database(
  jobs: Job[],
  completeFirstActivePage = false,
  events: EventRow[] = [],
  bets: BetRow[] = [],
  messages: Record<string, unknown>[] = [],
  evaluations: Record<string, unknown>[] = [],
) {
  let completedIds = new Set<string>();
  auth.client = createClient("https://database.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        let rows: Record<string, unknown>[];
        if (url.pathname.endsWith("/analysis_jobs")) {
          rows = jobs.map((row) =>
            completedIds.has(row.id) ? { ...row, status: "completed" } : row,
          );
        } else if (url.pathname.endsWith("/analysis_attempts")) { sourceAttemptQueries.push(url.search);rows=sourceAttempts;
        } else if (url.pathname.endsWith("/recommendation_evaluations")) {
          expect(url.searchParams.get("select")).toBe("*,successors:recommendation_evaluation_successors(id)");
          rows = evaluations;
        } else if (url.pathname.endsWith("/messages")) {
          rows = messages;
        } else if (url.pathname.endsWith("/events")) {
          rows = events;
        } else if (url.pathname.endsWith("/bets")) {
          rows = bets;
        } else {
          rows = [];
        }
        for (const key of ["owner_id", "sport_id"] as const) {
          const filter = url.searchParams.get(key);
          if (filter?.startsWith("eq.")) rows = rows.filter((row) => row[key] === filter.slice(3));
        }
        const status = url.searchParams.get("status");
        if (status?.startsWith("in.(")) {
          const values = status.slice(4, -1).split(",");
          rows = rows.filter((row) => values.includes(String(row.status)));
        }
        const afterId = url.searchParams.get("id");
        if(afterId?.startsWith("in.(")){sourceJobQueries.push(afterId);const ids=afterId.slice(4,-1).split(",");rows=rows.filter(row=>ids.includes(String(row.id)));}
        if (afterId?.startsWith("gt.")) rows = rows.filter((row) => String(row.id) > afterId.slice(3));
        const order = (url.searchParams.get("order") || "created_at.desc,id.desc")
          .split(",")
          .map((term) => {
            const [field, direction] = term.split(".");
            return { field, direction };
          });
        rows.sort((a, b) => {
          for (const { field, direction } of order) {
            const comparison = String(a[field] || "").localeCompare(String(b[field] || ""));
            if (comparison) return direction === "asc" ? comparison : -comparison;
          }
          return 0;
        });
        const offset = Number(url.searchParams.get("offset") || 0);
        const limit = Math.min(Number(url.searchParams.get("limit") || 1000), 1000);
        const page = rows.slice(offset, offset + limit);
        if (completeFirstActivePage && status?.startsWith("in.(") && !completedIds.size)
          completedIds = new Set(page.map((row) => String(row.id)));
        return new Response(JSON.stringify(page), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });
}

async function loadJobs(): Promise<Job[]> {
  const response = await GET(new Request("http://localhost/api/sports/mlb"), { params: Promise.resolve({ sport: "mlb" }) });
  expect(response.status).toBe(200);
  return (await response.json()).jobs;
}

async function loadEvents() {
  const response = await GET(new Request("http://localhost/api/sports/mlb"), { params: Promise.resolve({ sport: "mlb" }) });
  expect(response.status).toBe(200);
  return (await response.json()).events as EventRow[];
}

async function loadBets() {
  const response = await GET(new Request("http://localhost/api/sports/mlb"), { params: Promise.resolve({ sport: "mlb" }) });
  expect(response.status).toBe(200);
  return (await response.json()).bets as BetRow[];
}

describe("sport job reattachment", () => {
  it("keeps old queued and running jobs beyond the latest 30 without duplicating recent active jobs", async () => {
    database([
      job("old-queued", "queued", 1),
      job("old-running", "running", 2),
      ...Array.from({ length: 30 }, (_, i) => job(`recent-${i}`, i === 29 ? "running" : "completed", i + 3)),
      { ...job("other-owner", "queued", 50), owner_id: "someone-else" },
      { ...job("other-sport", "running", 50), sport_id: "another-sport" },
    ]);
    const jobs = await loadJobs();
    expect(jobs).toHaveLength(32);
    expect(jobs.map((item) => item.id)).toContain("old-queued");
    expect(jobs.map((item) => item.id)).toContain("old-running");
    expect(jobs[0].id).toBe("recent-29");
    expect(new Set(jobs.map((item) => item.id)).size).toBe(32);
    expect(jobs.every((item) => item.owner_id === "owner" && item.sport_id === "sport")).toBe(true);
  });

  it("reattaches active jobs across the database's 1000-row response limit", async () => {
    database(Array.from({ length: 1001 }, (_, i) => job(`active-${i}`, "queued", i + 1)));
    const jobs = await loadJobs();
    expect(jobs).toHaveLength(1001);
    expect(jobs[jobs.length - 1]?.id).toBe("active-0");
  });

  it("does not skip pending work when jobs from an earlier page finish during reload", async () => {
    database(Array.from({ length: 1001 }, (_, i) => job(`active-${String(i).padStart(4, "0")}`, "queued", 1001 - i)), true);
    const jobs = await loadJobs();
    expect(jobs).toHaveLength(1001);
  });
});

describe("sport event state", () => {
  it("returns imported event sets beyond 40 rows and sorts timestamp ties by id", async () => {
    const updatedAt = "2026-09-25T12:00:00.000Z";
    database([], false, Array.from({ length: 55 }, (_, i) => ({
      id: `event-${String(i).padStart(3, "0")}`,
      updated_at: updatedAt,
      owner_id: "owner",
      sport_id: "sport",
    })));

    const events = await loadEvents();

    expect(events).toHaveLength(55);
    expect(events[0]?.id).toBe("event-054");
    expect(events[54]?.id).toBe("event-000");
  });
});

describe("sport bet records", () => {
  it("returns all 50 imported historical bets", async () => {
    const createdAt = "2026-09-25T12:00:00.000Z";
    database([], false, [], Array.from({ length: 50 }, (_, i) => ({
      id: `bet-${String(i).padStart(3, "0")}`,
      created_at: createdAt,
      owner_id: "owner",
      sport_id: "sport",
    })));

    const bets = await loadBets();

    expect(bets).toHaveLength(50);
  });
});


it("projects server-validated partial state into assistant messages without rewriting legacy rows", async () => {
  const metadata = { extraction_status: "partial", original_model_response: "kept raw" };
  const partial = { id: "partial", role: "assistant", analysis_job_id: "job-partial", content: "historical original-only warning", metadata, created_at: "2026-10-27T15:00:00Z", owner_id: "owner", sport_id: "sport" };
  const legacy = { id: "legacy", role: "assistant", content: "kept legacy", metadata: { extraction_status: "complete" }, created_at: "2026-10-26T15:00:00Z", owner_id: "owner", sport_id: "sport" };
  const dto = { status: "partial", eventCount: 6, inputEventCount: 8, recommendationCount: 12, inputRecommendationCount: 14 };
  recoveryProjection.project.mockReturnValueOnce(dto);
  database([], false, [], [], [legacy, partial]);
  const response = await GET(new Request("http://localhost/api/sports/mlb"), { params: Promise.resolve({ sport: "mlb" }) });
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.messages.find((row: { id: string }) => row.id === "partial")).toEqual({ ...partial, metadata: { extraction_status: "partial" }, recovery: dto, conditionalEntrySources:[] });
  expect(body.messages.find((row: { id: string }) => row.id === "legacy")).toEqual({...legacy,conditionalEntrySources:[]});
  expect(recoveryProjection.project).toHaveBeenCalledWith(metadata, { jobId: "job-partial", messageId: "partial", sport: "mlb" });
});

it("loads frozen evaluation history with explicit reverse successor provenance",async()=>{
 const row={id:"evaluation",owner_id:"owner",sport_id:"sport",created_at:"2026-10-01T00:00:00Z",successors:[{id:"later"}],frozen_recommendation:{event:{starts_at:null},recommendation:{market:"unknown"},checked_at:null,delivered_at:"2026-10-01T00:00:00Z"},evaluation_input:{}};
 database([],false,[],[],[],[row]);
 const response=await GET(new Request("http://localhost/api/sports/mlb"),{params:Promise.resolve({sport:"mlb"})});
 expect(response.status).toBe(200);
 expect((await response.json()).recommendationEvaluations).toEqual([expect.objectContaining({id:"evaluation",is_current:false,evaluation:expect.objectContaining({status:"unscored",profit_per_unit:null})})]);
});

it("batch loads historical paginated message jobs outside the recent thirty and derives private no-store sources",async()=>{
 const fixture=entryFixture();
 const input=JSON.parse(JSON.stringify(fixture.input()).replaceAll("tennis","mlb").replaceAll("2026-10-27","2026-10-20"));
 const original=input.message;
 const oldJob=Object.assign(job(input.jobId,"completed",1),{kind:"analyze_today",result_type:"analysis",result_message_id:original.id,current_attempt_id:original.metadata.input_snapshot.attempt_id,provider_metadata:original.metadata});
 const newer=Array.from({length:40},(_,i)=>job(`recent-${i}`,"completed",i+2));
 sourceAttempts=[trustedEntryAttempt(input)];
 sourceJobQueries.length=0;
 database([oldJob,...newer],false,[],[],[original]);
 const response=await GET(new Request("http://localhost/api/sports/mlb"),{params:Promise.resolve({sport:"mlb"})});
 expect(response.status).toBe(200);
 expect(response.headers.get("cache-control")).toBe("private, no-store");
 const body=await response.json();
 expect(body.jobs.find((row:Job)=>row.id===oldJob.id)).toBeUndefined();
 expect(sourceJobQueries).toContain(`in.(${oldJob.id})`);
 expect(body.messages[0].conditionalEntrySources).toMatchObject([{source:{jobId:oldJob.id,messageId:original.id,sourceKind:"original_block"},selection:"Alpha",schedule:{at:"2026-10-20T22:30:00-04:00"}}]);
 expect(body.messages[0].conditionalEntrySources[0]).not.toHaveProperty("stakeUnits");
});

it("adds no conditional source job or attempt reads for ordinary assistant history",async()=>{sourceJobQueries.length=0;sourceAttemptQueries.length=0;database([],false,[],[],[{id:"ordinary",owner_id:"owner",sport_id:"sport",role:"assistant",analysis_job_id:"ordinary-job",created_at:"2026-10-27T00:00:00Z",metadata:{original_model_response:"ordinary conversation"}}]);const response=await GET(new Request("http://localhost/api/sports/mlb"),{params:Promise.resolve({sport:"mlb"})});expect(response.status).toBe(200);expect(sourceJobQueries).toEqual([]);expect(sourceAttemptQueries).toEqual([]);expect((await response.json()).messages[0].conditionalEntrySources).toEqual([]);});

it("projects evaluation through the safe DTO only for analysis messages", async () => {
  const evaluationReport = { private_payload: "never return" };
  database([], false, [], [], [{
    id: "analysis", owner_id: "owner", sport_id: "sport", role: "assistant", analysis_job_id: "analysis-job", created_at: "2026-10-27T00:00:00Z",
    metadata: { type: "analysis", evaluation_report: evaluationReport, evaluation_validation: { private: "never return" } },
  }, {
    id: "conversation", owner_id: "owner", sport_id: "sport", role: "assistant", analysis_job_id: "chat-job", created_at: "2026-10-26T00:00:00Z",
    metadata: { type: "conversation", evaluation_report: evaluationReport, evaluation_validation: { private: "never return" } },
  }]);
  const response = await GET(new Request("http://localhost/api/sports/mlb"), { params: Promise.resolve({ sport: "mlb" }) });
  const body = await response.json();
  const analysis = body.messages.find((message: { id: string }) => message.id === "analysis");
  const conversation = body.messages.find((message: { id: string }) => message.id === "conversation");
  expect(analysis.evaluation).toMatchObject({ report: null, validation: { status: "invalid", reasons: ["evaluation_metadata_invalid"] } });
  expect(analysis.metadata).not.toHaveProperty("evaluation_report");
  expect(analysis.metadata).not.toHaveProperty("evaluation_validation");
  expect(conversation).not.toHaveProperty("evaluation");
  expect(JSON.stringify(body)).not.toContain("never return");
});
