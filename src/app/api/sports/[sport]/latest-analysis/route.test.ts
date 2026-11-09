import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  client: null as unknown as SupabaseClient,
  ownerError: null as Response | null,
  jobs: [] as Record<string, unknown>[],
  messages: [] as Record<string, unknown>[],
  requests: [] as URL[],
}));

vi.mock("@/lib/supabase/server", () => ({
  requireOwner: async () => {
    if (mocks.ownerError) throw mocks.ownerError;
    return { supabase: mocks.client, user: { id: "owner" } };
  },
  apiError: (error: unknown) => error instanceof Response
    ? error
    : Response.json({ error: "Unexpected error" }, { status: 500 }),
}));
vi.mock("@/lib/analysis/data", () => ({
  isSportSlug: (slug: string) => ["mlb", "nhl", "tennis"].includes(slug),
  getOrCreateSport: async (_supabase: unknown, _owner: string, slug: string) => ({ id: "sport", slug }),
}));

function database() {
  mocks.client = createClient("https://database.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        mocks.requests.push(url);
        let rows = url.pathname.endsWith("/analysis_jobs") ? mocks.jobs : mocks.messages;
        for (const key of ["owner_id", "sport_id", "status", "role", "id"] as const) {
          const filter = url.searchParams.get(key);
          if (filter?.startsWith("eq.")) rows = rows.filter((row) => String(row[key]) === filter.slice(3));
        }
        const resultTypeFilter = url.searchParams.get("or");
        if (resultTypeFilter?.includes("result_type.is.null") && resultTypeFilter.includes("result_type.eq.analysis")) {
          rows = rows.filter((row) => row.result_type == null || row.result_type === "analysis");
        }
        const order = (url.searchParams.get("order") || "")
          .split(",")
          .filter(Boolean)
          .map((term) => {
            const [field, direction] = term.split(".");
            return { field, direction };
          });
        rows = [...rows].sort((a, b) => {
          for (const { field, direction } of order) {
            const compare = String(a[field] || "").localeCompare(String(b[field] || ""));
            if (compare) return direction === "asc" ? compare : -compare;
          }
          return 0;
        });
        const limit = Number(url.searchParams.get("limit") || 1000);
        return new Response(JSON.stringify(rows.slice(0, limit)), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });
}

function job(id: string, updatedAt: string, resultMessageId: string | null) {
  return {
    id,
    kind: "analyze_today",
    status: "completed",
    created_at: updatedAt,
    updated_at: updatedAt,
    result_message_id: resultMessageId,
    owner_id: "owner",
    sport_id: "sport",
  };
}

async function getLatest(sport = "mlb") {
  return GET(new Request(`http://localhost/api/sports/${sport}/latest-analysis`), {
    params: Promise.resolve({ sport }),
  });
}

beforeEach(() => {
  mocks.ownerError = null;
  mocks.jobs = [];
  mocks.messages = [];
  mocks.requests = [];
  database();
});

describe("GET /api/sports/[sport]/latest-analysis", () => {
  it("skips completed conversation jobs before choosing the latest analysis", async () => {
    mocks.jobs = [
      { ...job("conversation", "2026-09-28T11:00:00Z", "chat-message"), kind: "message", result_type: "conversation" },
      job("latest-analysis", "2026-09-27T11:00:00Z", "analysis-message"),
    ];
    mocks.messages = [
      { id: "chat-message", owner_id: "owner", sport_id: "sport", role: "assistant", content: "자연스러운 답변" },
      { id: "analysis-message", owner_id: "owner", sport_id: "sport", role: "assistant", content: "# 분석\n\n| 경기 | 판단 |\n| --- | --- |\n| A | PASS |" },
    ];

    const response = await getLatest();
    const body = await response.json();

    expect(body.analysis).toMatchObject({ jobId: "latest-analysis", hasTable: true });
    const jobsRead = mocks.requests.find((url) => url.pathname.endsWith("/analysis_jobs"));
    expect(jobsRead?.searchParams.get("or")).toContain("result_type.eq.analysis");
  });

  it("uses the latest completed owned sport job and reads only its linked assistant message", async () => {
    mocks.jobs = [
      job("older", "2026-09-26T11:00:00Z", "message-old"),
      job("latest", "2026-09-27T11:00:00Z", "message-latest"),
      { ...job("other-owner", "2026-09-28T11:00:00Z", "message-other"), owner_id: "other" },
      { ...job("other-sport", "2026-09-29T11:00:00Z", "message-other-sport"), sport_id: "other" },
      { ...job("not-completed", "2026-09-30T11:00:00Z", "message-pending"), status: "running" },
    ];
    mocks.messages = [
      {
        id: "message-latest",
        owner_id: "owner",
        sport_id: "sport",
        role: "assistant",
        content: "# 신규 BET 없음\n\n| 경기 | 판단 |\n| --- | --- |\n| A vs B | PASS |",
        metadata: {
          coverage: {
            status: "incomplete",
            scope: { version: 1, sport: "mlb", date_et: "2026-09-27", timezone: "America/New_York", mode: "daily", competitions: ["MLB"], basis: "default", parent_message_id: "private-parent", notes: [] },
            listed_count: 2, assessed_count: 1, missing_event_keys: ["mlb:2026-09-27:game-2"], reasons: ["one event remains unassessed"],
            coverage_report: { source_url: "https://private.example/schedule" },
          },
          input: "private-input", original_response: "private-response", audit_snapshot: { token: "private-token" },
        },
      },
    ];

    const response = await getLatest();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.analysis).toEqual({
      jobId: "latest",
      kind: "analyze_today",
      completedAt: "2026-09-27T11:00:00Z",
      analysisTitle: "신규 BET 없음",
      tableTitle: "신규 BET 없음",
      tableMarkdown: "| 경기 | 판단 |\n| --- | --- |\n| A vs B | PASS |",
      hasTable: true,
      executionRows: [{ match: "A vs B", startTime: null, decision: "PASS", units: null, unknowns: null }],
      coverage: {
        status: "incomplete",
        scope: { date_et: "2026-09-27", competitions: ["MLB"], notes: [] },
        listed_count: 2,
        assessed_count: 1,
        missing_event_keys: ["mlb:2026-09-27:game-2"],
        reasons: ["one event remains unassessed"],
      },
      evaluation: null,
      evaluationPresentation: null,
      savedBodyExists: true,
      tableContext: "current",
    });
    expect(JSON.stringify(body)).not.toContain("private-");
  });

  it("adds recovery status only for a persisted NHL v2 record with a matching audit", async () => {
    const raw = "saved original response";
    const content = "# Historical result\n\n| Event | Decision |\n| --- | --- |\n| A vs B | PASS |";
    mocks.jobs = [job("repair-job", "2026-10-23T18:00:00Z", "repair-message")];
    mocks.messages = [{
      id: "repair-message", owner_id: "owner", sport_id: "sport", role: "assistant", content,
      metadata: {
        original_model_response: raw,
        checked_at: "2026-10-23T14:05:29.255Z",
        extraction_status: "complete",
        recommendations_persisted: true,
        analysis_record: { events: [{ event_key: "one" }, { event_key: "two" }], recommendations: Array.from({ length: 13 }, () => ({})) },
        completed_analysis_repairs: [{
          version: "official-source-coverage-v2", repair_key: "repair", request_sha256: "a".repeat(64),
          raw_sha256: createHash("sha256").update(raw).digest("hex"), repaired_at: "2026-10-23T18:00:00Z",
          record_event_count: 2, record_recommendation_count: 13, job_id: "repair-job", message_id: "repair-message",
          attempt_id: "repair-attempt",
          recommendation_key_corrections: [{ reason: "unique_official_game_id", raw_sha256: createHash("sha256").update(raw).digest("hex"), item_key: "item-1", from: "old", to: "canonical" }],
          independent_source_verifications: [], source_verified_at: null, source_verification_scope: null,
        }],
      },
    }];

    const response = await getLatest("nhl");
    const { analysis } = await response.json();

    expect(analysis).toMatchObject({
      tableMarkdown: "| Event | Decision |\n| --- | --- |\n| A vs B | PASS |",
      recovery: { status: "repaired", originalCheckedAt: "2026-10-23T14:05:29.255Z", eventCount: 2, recommendationCount: 13 },
    });
    expect(analysis.tableMarkdown).toBe(content.split("\n\n")[1]);
  });

  it("returns a null analysis when no completed job exists", async () => {
    mocks.jobs = [{ ...job("running", "2026-09-27T11:00:00Z", "message"), status: "running" }];

    const response = await getLatest();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ analysis: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns a completed job with an explicit unavailable table state when no table is saved", async () => {
    mocks.jobs = [job("latest", "2026-09-27T11:00:00Z", "message")];
    mocks.messages = [{
      id: "message",
      owner_id: "owner",
      sport_id: "sport",
      role: "assistant",
      content: "# 분석 결과\nBET | PASS에 대한 설명만 있습니다.",
    }];

    const response = await getLatest();
    const body = await response.json();

    expect(body.analysis).toMatchObject({
      jobId: "latest",
      analysisTitle: "분석 결과",
      tableTitle: null,
      tableMarkdown: null,
      hasTable: false,
      coverage: null,
    });
  });

  it("returns the owner guard response without querying data", async () => {
    mocks.ownerError = new Response("Sign in required", { status: 401 });

    const response = await getLatest();

    expect(response.status).toBe(401);
  });
});

it("does not let a repaired older job replace the latest originally created analysis",async()=>{
 mocks.jobs=[{...job("older-repaired","2026-10-29T12:00:00Z","older-message"),created_at:"2026-10-26T12:00:00Z"},job("newer","2026-10-27T12:00:00Z","newer-message")];
 mocks.messages=[{id:"newer-message",owner_id:"owner",sport_id:"sport",role:"assistant",content:"# Newer answer"}];
 const response=await GET(new Request("http://localhost/api/sports/mlb/latest-analysis"),{params:Promise.resolve({sport:"mlb"})});
 expect((await response.json()).analysis).toMatchObject({jobId:"newer",analysisTitle:"Newer answer"});
 expect(mocks.requests.find(url=>url.pathname.endsWith("/analysis_jobs"))?.searchParams.get("order")).toBe("created_at.desc,id.desc");
});

it("verifies historical excerpt hashes before exposing display and never returns raw", async () => {
  const raw = "# Historical\n| Market | Decision |\n| --- | --- |\n| Old | GO |";
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  mocks.jobs = [job("j", "2026-10-29T10:00:00Z", "m")];
  mocks.messages = [{ id: "m", owner_id: "owner", sport_id: "sport", role: "assistant", content: "Saved body", metadata: { original_model_response: raw, evaluation_presentation: { version: 1, context: "historical", reason: "No current markets", raw_sha256: hash(raw), reviewedTables: [{ start: 0, end: Buffer.byteLength(raw), excerpt_sha256: hash(raw) }] } } }];
  const data = await (await getLatest()).json();
  expect(data.analysis.tableContext).toBe("historical"); expect(data.analysis.executionRows).toEqual([]); expect(data.analysis.evaluationPresentation.context).toBe("historical");
  expect(JSON.stringify(data)).not.toContain("raw_sha256"); expect(JSON.stringify(data)).not.toContain("original_model_response");
  (mocks.messages[0].metadata as { original_model_response: string }).original_model_response += "tamper";
  const tampered = await (await getLatest()).json(); expect(tampered.analysis.evaluationPresentation).toBeNull(); expect(tampered.analysis.tableMarkdown).toBeNull();
});
