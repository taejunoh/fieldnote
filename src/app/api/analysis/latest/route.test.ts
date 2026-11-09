import { exactFixture } from "../../../../lib/analysis/reviewed-exact-bets.fixture";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { GET } from "./route";

const slugs = ["mlb", "nfl", "cfb", "soccer", "tennis", "nba", "wnba", "nhl"];
const mocks = vi.hoisted(() => ({
  client: null as unknown as SupabaseClient,
  overlays: [] as unknown[],
  exactOverlays: [] as unknown[],
  ownerError: null as Response | null,
  sports: [] as Record<string, unknown>[],
  jobs: [] as Record<string, unknown>[],
  messages: [] as Record<string, unknown>[],
  attempts: [] as Record<string,unknown>[],
  requests: [] as URL[],
}));

vi.mock("../../../../lib/analysis/private-display-candidates",()=>({loadPrivateDisplayCandidates:async()=>mocks.overlays,loadPrivateOverviewCandidates:async()=>({conditional:mocks.overlays,exact:mocks.exactOverlays})}));

vi.mock("@/lib/supabase/server", () => ({
  requireOwner: async () => {
    if (mocks.ownerError) throw mocks.ownerError;
    return { supabase: mocks.client, user: { id: "owner" } };
  },
  apiError: (error: unknown) => error instanceof Response
    ? error
    : Response.json({ error: "Unexpected error" }, { status: 500 }),
}));

function database() {
  mocks.client = createClient("https://database.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        mocks.requests.push(url);
        let rows = url.pathname.endsWith("/sports")
          ? mocks.sports
          : url.pathname.endsWith("/analysis_jobs")
            ? mocks.jobs
            : url.pathname.endsWith("/analysis_attempts") ? mocks.attempts : mocks.messages;
        for (const key of ["owner_id", "sport_id", "status", "role", "id","job_id"] as const) {
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
        return new Response(JSON.stringify(rows.slice(0, Number(url.searchParams.get("limit") || 1000))), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });
}

function job(id: string, sportId: string, updatedAt: string, messageId: string | null) {
  return {
    id,
    kind: "analyze_today",
    status: "completed",
    created_at: updatedAt,
    updated_at: updatedAt,
    result_message_id: messageId,
    owner_id: "owner",
    sport_id: sportId,
  };
}

beforeEach(() => {
  mocks.overlays=[];
  mocks.exactOverlays=[];
  mocks.attempts=[];
  mocks.ownerError = null;
  mocks.sports = [];
  mocks.jobs = [];
  mocks.messages = [];
  mocks.requests = [];
  database();
});

describe("GET /api/analysis/latest", () => {
  it("returns allowlisted coverage for all eight sports", async () => {
    mocks.sports = slugs.map((slug) => ({ id: `${slug}-id`, slug, owner_id: "owner" }));
    mocks.jobs = slugs.map((slug) => job(`${slug}-job`, `${slug}-id`, "2026-09-30T11:00:00Z", `${slug}-message`));
    mocks.messages = slugs.map((slug) => ({
      id: `${slug}-message`,
      sport_id: `${slug}-id`,
      owner_id: "owner",
      role: "assistant",
      content: `# ${slug}`,
      metadata: {
        coverage: {
          status: "unverified",
          scope: { version: 1, sport: slug, date_et: "2026-09-30", timezone: "America/New_York", mode: "daily", competitions: slug === "soccer" ? [] : [slug.toUpperCase()], basis: "default", parent_message_id: "private-parent", notes: slug === "soccer" ? ["invalid_or_ambiguous_request_date"] : [] },
          listed_count: 2, assessed_count: 2, missing_event_keys: [], reasons: slug === "soccer" ? ["competition_scope_unknown"] : [],
          coverage_report: { inventory: [{ source_url: "private-source" }] },
        },
        input: "private-input", audit_snapshot: { secret: "private-secret" },
      },
    }));

    const response = await GET();
    const body = await response.json();

    expect(body.sports.map(({ analysis }: { analysis: { coverage: { status: string; scope: { competitions: string[] } } } }) => [analysis.coverage.status, analysis.coverage.scope.competitions])).toEqual(
      slugs.map((slug) => ["unverified", slug === "soccer" ? [] : [slug.toUpperCase()]]),
    );
    expect(body.sports.find(({ sport }: { sport: string }) => sport === "soccer").analysis.coverage.scope.notes).toEqual(["invalid_or_ambiguous_request_date"]);
    expect(JSON.stringify(body)).not.toContain("private-");
  });

  it("returns every sport and the newest completed job even when that answer has no table", async () => {
    mocks.sports = [
      { id: "mlb-id", slug: "mlb", owner_id: "owner" },
      { id: "soccer-id", slug: "soccer", owner_id: "owner" },
      { id: "other-id", slug: "nfl", owner_id: "other" },
    ];
    mocks.jobs = [
      job("old-table", "mlb-id", "2026-09-26T11:00:00Z", "old-message"),
      job("new-no-table", "mlb-id", "2026-09-27T11:00:00Z", "new-message"),
      { ...job("new-conversation", "mlb-id", "2026-09-28T11:00:00Z", "chat-message"), kind: "message", result_type: "conversation" },
      job("soccer-result", "soccer-id", "2026-09-28T11:00:00Z", "soccer-message"),
      { ...job("running", "soccer-id", "2026-09-29T11:00:00Z", "running-message"), status: "running" },
      { ...job("foreign", "mlb-id", "2026-09-30T11:00:00Z", "foreign-message"), owner_id: "other" },
    ];
    mocks.messages = [
      { id: "new-message", sport_id: "mlb-id", owner_id: "owner", role: "assistant", content: "# 분석 결과\n표는 없습니다." },
      { id: "chat-message", sport_id: "mlb-id", owner_id: "owner", role: "assistant", content: "자연스러운 답변" },
      {
        id: "soccer-message", sport_id: "soccer-id", owner_id: "owner", role: "assistant",
        content: "# 경기 분석\n\n| 경기 | 판단 |\n| --- | --- |\n| A vs B | PASS |",
        metadata: {
          coverage: {
            status: "unverified",
            scope: { version: 1, sport: "soccer", date_et: "2026-09-30", timezone: "America/New_York", mode: "daily", competitions: ["MLS"], basis: "default", parent_message_id: "private-parent", notes: ["competition_scope_unknown"] },
            listed_count: 1, assessed_count: 1, missing_event_keys: [], reasons: ["independent schedule collection unavailable"],
            coverage_report: { source_url: "https://private.example/schedule" },
          },
          input: "private-input", original_response: "private-response", audit_snapshot: { token: "private-token" },
        },
      },
    ];

    const response = await GET();
    const body = await response.json();
    const { sports } = body;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(sports.map(({ sport }: { sport: string }) => sport)).toEqual(slugs);
    expect(sports[0].analysis).toMatchObject({
      jobId: "new-no-table",
      kind: "analyze_today",
      completedAt: "2026-09-27T11:00:00Z",
      analysisTitle: "분석 결과",
      tableTitle: null,
      tableMarkdown: null,
      hasTable: false,
      coverage: null,
    });
    const mlbJobsRead = mocks.requests.find((url) => url.pathname.endsWith("/analysis_jobs") && url.searchParams.get("sport_id") === "eq.mlb-id");
    expect(mlbJobsRead?.searchParams.get("or")).toContain("result_type.eq.analysis");
    expect(sports[3].analysis).toMatchObject({
      jobId: "soccer-result",
      analysisTitle: "경기 분석",
      tableMarkdown: "| 경기 | 판단 |\n| --- | --- |\n| A vs B | PASS |",
      hasTable: true,
      executionRows: [{ match: "A vs B", startTime: null, decision: "PASS", units: null, unknowns: null }],
      coverage: {
        status: "unverified",
        scope: { date_et: "2026-09-30", competitions: ["MLS"], notes: ["competition_scope_unknown"] },
        listed_count: 1,
        assessed_count: 1,
        missing_event_keys: [],
        reasons: ["independent schedule collection unavailable"],
      },
    });
    expect(JSON.stringify(body)).not.toContain("private-");
    expect(sports.filter(({ analysis }: { analysis: unknown }) => analysis === null)).toHaveLength(slugs.length - 2);
  });

  it("projects a verified recovery DTO on the unified latest table", async () => {
    const raw = "saved original response";
    mocks.sports = [{ id: "nhl-id", slug: "nhl", owner_id: "owner" }];
    mocks.jobs = [job("nhl-job", "nhl-id", "2026-10-23T18:00:00Z", "nhl-message")];
    mocks.messages = [{
      id: "nhl-message", sport_id: "nhl-id", owner_id: "owner", role: "assistant",
      content: "# Historical result\n\n| Event | Result |\n| --- | --- |\n| A vs B | PASS |",
      metadata: {
        original_model_response: raw,
        checked_at: "2026-10-23T14:05:29.255Z",
        extraction_status: "complete",
        recommendations_persisted: true,
        analysis_record: { events: [{}, {}], recommendations: Array.from({ length: 13 }, () => ({})) },
        completed_analysis_repairs: [{
          version: "official-source-coverage-v2", repair_key: "repair", request_sha256: "a".repeat(64),
          raw_sha256: createHash("sha256").update(raw).digest("hex"), repaired_at: "2026-10-23T18:00:00Z",
          record_event_count: 2, record_recommendation_count: 13, job_id: "nhl-job", message_id: "nhl-message",
          attempt_id: "nhl-attempt",
          recommendation_key_corrections: [{ reason: "unique_official_game_id", raw_sha256: createHash("sha256").update(raw).digest("hex"), item_key: "item-1", from: "old", to: "canonical" }],
          independent_source_verifications: [], source_verified_at: null, source_verification_scope: null,
        }],
      },
    }];

    const response = await GET();
    const { sports: result } = await response.json();

    expect(result.find(({ sport }: { sport: string }) => sport === "nhl").analysis.recovery).toMatchObject({
      status: "repaired", eventCount: 2, recommendationCount: 13, sourceVerifiedAt: null,
    });
  });

  it("scopes sport, job, and linked assistant message reads to the owner and sport", async () => {
    mocks.sports = [{ id: "mlb-id", slug: "mlb", owner_id: "owner" }];
    mocks.jobs = [job("latest", "mlb-id", "2026-09-27T11:00:00Z", "linked")];
    mocks.messages = [
      { id: "linked", sport_id: "other-id", owner_id: "owner", role: "assistant", content: "# Wrong sport" },
      { id: "linked", sport_id: "mlb-id", owner_id: "other", role: "assistant", content: "# Wrong owner" },
      { id: "linked", sport_id: "mlb-id", owner_id: "owner", role: "user", content: "# Wrong role" },
    ];

    const response = await GET();
    const { sports } = await response.json();

    expect(sports[0].analysis).toMatchObject({ jobId: "latest", analysisTitle: null, hasTable: false, coverage: null });
    const sportsRead = mocks.requests.find((url) => url.pathname.endsWith("/sports"))!;
    const jobsRead = mocks.requests.find((url) => url.pathname.endsWith("/analysis_jobs"))!;
    const messageRead = mocks.requests.find((url) => url.pathname.endsWith("/messages"))!;
    expect(sportsRead.searchParams.get("owner_id")).toBe("eq.owner");
    expect(jobsRead.searchParams.get("owner_id")).toBe("eq.owner");
    expect(jobsRead.searchParams.get("sport_id")).toBe("eq.mlb-id");
    expect(jobsRead.searchParams.get("status")).toBe("eq.completed");
    expect(messageRead.searchParams.get("id")).toBe("eq.linked");
    expect(messageRead.searchParams.get("owner_id")).toBe("eq.owner");
    expect(messageRead.searchParams.get("sport_id")).toBe("eq.mlb-id");
    expect(messageRead.searchParams.get("role")).toBe("eq.assistant");
    expect(mocks.requests.every((url) => !url.searchParams.has("on_conflict"))).toBe(true);
  });

  it("returns the owner guard response without querying data", async () => {
    mocks.ownerError = new Response("Sign in required", { status: 401 });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.requests).toEqual([]);
  });
});

describe("compact actionable BET projection",()=>{
  const raw=(decision="BET")=>`Source assessment\n\n\`\`\`analysis-record\n${JSON.stringify({version:1,sport:"mlb",events:[{event_key:"mlb:2099-10-27:away@home:src",label:"Away at Home",starts_at:"2099-10-27T22:00:00Z",source_url:"https://unregistered.example/event",analysis_status:"WAIT"}],recommendations:[{item_key:"pick",event_key:"mlb:2099-10-27:away@home:src",market:"moneyline",selection:"Away",decision,suggested_units:decision==="BET"?1:null,price_gate:"-110 or better"}]})}\n\`\`\``;
  const message=(id:string,decision="BET")=>({id,owner_id:"owner",sport_id:"mlb-id",role:"assistant",created_at:"2026-10-27T15:00:01Z",content:"# Original analysis",metadata:{checked_at:"2026-10-27T15:00:00Z",common_policy:{id:"policy"},original_model_response:raw(decision),extraction_status:"incomplete",analysis_record:{events:[],recommendations:[]}}});
  it("projects the original BET when every proposed storage row was rejected",async()=>{
    mocks.sports=[{id:"mlb-id",slug:"mlb",owner_id:"owner"}];mocks.jobs=[job("current","mlb-id","2026-10-27T15:00:00Z","source")];mocks.messages=[message("source")];
    const response=await GET();const body=await response.json();
    expect(body.sports[0].analysis).toMatchObject({actionState:"ready",actionableBets:[{match:"Away at Home",messageId:"source",jobId:"current",priceGate:"-110 or better"}],needsReview:{count:0}});
    expect(JSON.stringify(body)).not.toContain("original_model_response");
    expect(mocks.requests.filter(url=>url.pathname.endsWith("/analysis_jobs"))).toHaveLength(1);
    expect(mocks.requests.some(url=>url.pathname.endsWith("/analysis_attempts"))).toBe(false);
    expect(mocks.requests.find(url=>url.pathname.endsWith("/messages"))?.searchParams.get("select")).toBe("id,owner_id,sport_id,analysis_job_id,role,created_at,content,metadata");
  });
  it("orders by original job creation, never repair update time, and does not fall back to an older BET",async()=>{
    mocks.sports=[{id:"mlb-id",slug:"mlb",owner_id:"owner"}];
    mocks.jobs=[{...job("old-repaired","mlb-id","2026-10-29T15:00:00Z","old"),created_at:"2026-10-26T15:00:00Z"},job("latest-pass","mlb-id","2026-10-27T15:00:00Z","latest")];mocks.messages=[message("old"),message("latest","PASS")];
    const response=await GET();const body=await response.json();
    expect(body.sports[0].analysis).toMatchObject({jobId:"latest-pass",actionState:"ready",actionableBets:[]});
    expect(mocks.requests.find(url=>url.pathname.endsWith("/analysis_jobs"))?.searchParams.get("order")).toBe("created_at.desc,id.desc");
    expect(mocks.requests.filter(url=>url.pathname.endsWith("/messages")).map(url=>url.searchParams.get("id"))).toEqual(["eq.latest"]);
  });
  it("never uses a wrong-owner or wrong-sport linked message as recommendation evidence",async()=>{
    mocks.sports=[{id:"mlb-id",slug:"mlb",owner_id:"owner"}];mocks.jobs=[job("current","mlb-id","2026-10-27T15:00:00Z","source")];mocks.messages=[{...message("source"),owner_id:"other"},{...message("source"),sport_id:"nba-id"}];
    const response=await GET();expect((await response.json()).sports[0].analysis).toMatchObject({actionState:"unavailable",actionableBets:[]});
  });
});

it("returns conditional candidates only for the authenticated latest linked source while preserving no-store",async()=>{
 mocks.sports=[{id:"tennis-id",slug:"tennis",owner_id:"owner"}];mocks.jobs=[job("current","tennis-id","2026-10-27T15:00:00Z","source")];
 const key="tennis:2099-10-27:alpha@beta:src",url="https://example.org/schedule";
 const raw=`Original GO Alpha 0.25U, 2.04+, Not before22:30, Upcoming.\n\n\`\`\`analysis-coverage\n${JSON.stringify({version:1,scope:{sport:"tennis",date_et:"2099-10-27"},inventory:[{event_key:key,label:"Alpha versus Beta",starts_at:null,source_url:url}],assessments:[{event_key:key,disposition:"evaluated"}]})}\n\`\`\`\n\n\`\`\`analysis-record\n{"version":1,"sport":"tennis","events":[],"recommendations":[]}\n\`\`\``;
 const message={id:"source",owner_id:"owner",sport_id:"tennis-id",role:"assistant",created_at:"2026-10-27T15:00:01Z",content:"Original answer",metadata:{original_model_response:raw,checked_at:"2026-10-27T15:00:00Z",common_policy:{id:"policy"}}};mocks.messages=[message];
 const evidence=raw.split("\n")[0];
 const entry={owner_id:"owner",sport:"tennis",job_id:"current",message_id:"source",raw_sha256:createHash("sha256").update(raw).digest("hex"),checked_at:"2026-10-27T15:00:00Z",created_at:"2026-10-27T15:00:01Z",delivered_at:"2026-10-27T15:00:01Z",envelope:{version:1,sport:"tennis",candidates:[{item_key:"pick",event_key:key,market:"Moneyline",selection:"Alpha",decision:"GO",suggested_units:0.25,price_gate:"2.04+",source_url:url,schedule:{precision:"not_before",date_et:"2099-10-27",at:"2099-10-27T22:30:00-04:00",label:"Not before22:30"},status_at_assessment:"scheduled"}]},coverage:[{event_key:key,label:"Alpha versus Beta",source_url:url,date_et:"2099-10-27"}],evidence:["recommendation","price","units","schedule","status"].map(role=>({role,start:0,end:Buffer.byteLength(evidence),text:evidence,sha256:createHash("sha256").update(evidence).digest("hex")}))};
 const snapshot={attempt_id:"attempt-source",context_sha256:"context-hash",instructions_sha256:"instructions-hash",common_policy:{id:"policy"}};
 Object.assign(message,{analysis_job_id:"current"});Object.assign(message.metadata,{type:"analysis",verified:true,searched:true,terminalStatus:"completed",input_snapshot:snapshot});
 Object.assign(mocks.jobs[0],{result_type:"analysis",current_attempt_id:"attempt-source",provider_metadata:structuredClone(message.metadata)});
 mocks.attempts=[{id:"attempt-source",owner_id:"owner",job_id:"current",status:"completed",provider_metadata:structuredClone(message.metadata),input_snapshot:{...snapshot,context:JSON.stringify({sport:"tennis",current_job_kind:"analyze_today"})}}];
 mocks.overlays=[entry];const response=await GET();expect(response.headers.get("cache-control")).toContain("no-store");expect((await response.json()).sports.find((r:{sport:string})=>r.sport==="tennis").analysis).toMatchObject({actionableBets:[],conditionalBets:[{startsAt:null,displayOnly:true,selection:"Alpha",priceGate:"2.04+",messageId:"source"}]});
 const originalAttempt=structuredClone(mocks.attempts[0]);
 mocks.attempts[0].provider_metadata={...(mocks.attempts[0].provider_metadata as Record<string,unknown>),hypothetical:true};
 expect((await (await GET()).json()).sports.find((r:{sport:string})=>r.sport==="tennis").analysis.conditionalBets).toEqual([]);
 mocks.attempts=[originalAttempt];
 mocks.overlays=[{...entry,owner_id:"other-owner"}];expect((await (await GET()).json()).sports.find((r:{sport:string})=>r.sport==="tennis").analysis.conditionalBets).toEqual([]);
});

function setupExactRoute() {
 const f=exactFixture(),i=f.input();
 mocks.sports=[{id:"soccer-id",slug:"soccer",owner_id:"owner"}];
 const snapshot={attempt_id:"attempt",context_sha256:"hash",instructions_sha256:"hash",common_policy:i.message.metadata.common_policy};
 const message={...i.message,owner_id:"owner",sport_id:"soccer-id",role:"assistant",analysis_job_id:i.jobId,content:"Original body",metadata:{...i.message.metadata,type:"analysis",verified:true,searched:true,terminalStatus:"completed",input_snapshot:snapshot}};
 const sourceJob={...job(i.jobId,"soccer-id",i.message.created_at,i.message.id),result_type:"analysis",current_attempt_id:"attempt",provider_metadata:structuredClone(message.metadata)};
 const attempt={id:"attempt",owner_id:"owner",job_id:i.jobId,status:"completed",provider_metadata:structuredClone(message.metadata),input_snapshot:{...snapshot,context:JSON.stringify({sport:"soccer",current_job_kind:"analyze_today"})}};
 mocks.jobs=[sourceJob];mocks.messages=[message];mocks.attempts=[attempt];mocks.exactOverlays=[f.overlay()];
 return {f,message,sourceJob,attempt};
}
it("exposes reviewed exact body rows only after reading the owner-bound immutable current attempt",async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2099-10-28T13:00:00Z"));
 try {
 setupExactRoute();const response=await GET(),body=await response.json(),analysis=body.sports.find((s:{sport:string})=>s.sport==="soccer").analysis;
 expect(response.headers.get("cache-control")).toBe("private, no-store");
 expect(analysis.actionableBets).toMatchObject([{provenance:"reviewed_original_body",displayOnly:true,originalDecision:"GO",selection:"Alpha"}]);
 expect(analysis.actionableBets[0]).not.toHaveProperty("entrySource");
 expect(mocks.requests.some(u=>u.pathname.endsWith("/analysis_attempts")&&u.searchParams.get("owner_id")==="eq.owner"&&u.searchParams.get("job_id")==="eq.job"&&u.searchParams.get("id")==="eq.attempt")).toBe(true);
 expect(JSON.stringify(body)).not.toContain("original_model_response");
 }finally{vi.useRealTimers();}
});
it("suppresses mutable dual tampering and missing immutable proof without returning false no recommendations",async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2099-10-28T13:00:00Z"));
 try {
 const {message,sourceJob}=setupExactRoute();message.metadata.original_model_response+="Tampering";sourceJob.provider_metadata=structuredClone(message.metadata);
 let analysis=(await (await GET()).json()).sports.find((s:{sport:string})=>s.sport==="soccer").analysis;
 expect(analysis.actionableBets).toEqual([]);expect(analysis.actionState).toBe("unavailable");
 setupExactRoute();mocks.attempts=[];analysis=(await (await GET()).json()).sports.find((s:{sport:string})=>s.sport==="soccer").analysis;
 expect(analysis.actionableBets).toEqual([]);expect(analysis.needsReview.count).toBeGreaterThan(0);
 }finally{vi.useRealTimers();}
});
