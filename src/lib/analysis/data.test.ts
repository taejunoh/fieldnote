import { describe, expect, it } from "vitest";
import { findLocalConversationRequest, loadAnalysisContext, type DatabaseClient } from "./data";

function pathValue(row: Record<string, unknown>, field: string): unknown {
  let value: unknown = row;
  for (const key of field.replaceAll("->>", "->").split("->")) {
    if (!value || typeof value !== "object" || !(key in value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

type ReviewTestQuery = {
  select: (fields?: string) => ReviewTestQuery;
  eq: (field: string, value: unknown) => ReviewTestQuery;
  in: (field: string, values: unknown[]) => ReviewTestQuery;
  lt: (field: string, value: string) => ReviewTestQuery;
  order: (field: string, options?: { ascending?: boolean }) => ReviewTestQuery;
  limit: (count: number) => Promise<{ data: Record<string, unknown>[]; error: null }>;
  range: (from: number, to: number) => Promise<{ data: Record<string, unknown>[]; error: null }>;
};

describe("loadAnalysisContext", () => {
  it("finds the latest valid review scope and same-date reports outside the recent 32 messages", async () => {
    const validMessage = (id: string, created_at: string, date_et: string, owner_id = "owner", sport_id = "sport", sportSlug = "tennis") => ({
      id, owner_id, sport_id, role: "assistant", created_at, content: id,
      metadata: { coverage: { status: "complete", scope: { version: 1, sport: sportSlug, date_et, timezone: "America/New_York", mode: "explicit", competitions: ["ATP singles main draw"], basis: "request" } } },
    });
    const parent = validMessage("parent", "2026-10-01T10:00:00Z", "2026-09-30");
    const sameDate = validMessage("same-date", "2026-10-01T09:00:00Z", "2026-09-30");
    const otherDate = validMessage("other-date", "2026-09-29T10:00:00Z", "2026-09-28");
    const invalidScope = validMessage("invalid-scope", "2026-09-28T10:00:00Z", "2026-02-30");
    const foreign = validMessage("foreign-owner", "2026-10-01T08:00:00Z", "2026-09-30", "someone-else");
    const foreignSport = validMessage("foreign-sport", "2026-10-01T08:00:00Z", "2026-09-30", "owner", "other-sport");
    const future = validMessage("future", "2026-10-14T16:00:00Z", "2026-10-13");
    const recent = Array.from({ length: 34 }, (_, index) => ({ id: `recent-${index}`, owner_id: "owner", sport_id: "sport", role: "assistant", created_at: new Date(Date.parse("2026-10-02T00:00:00Z") + index * 6 * 60 * 60 * 1000).toISOString(), content: `recent-${index}` }));
    const allMessages = [parent, sameDate, otherDate, invalidScope, foreign, foreignSport, future, ...recent];
    const db = { from(table: string) {
      let rows: Record<string, unknown>[] = table === "messages" ? allMessages : [];
      let projection = "*";
      const project = (row: Record<string, unknown>) => projection === "id,role,created_at,coverage:metadata->coverage"
        ? { id: row.id, role: row.role, created_at: row.created_at, coverage: pathValue(row, "metadata->coverage") } : row;
      const query: ReviewTestQuery = {
        select: (fields = "*") => { projection = fields; return query; },
        eq: (field: string, value: unknown) => { rows = rows.filter(row => pathValue(row, field) === value); return query; },
        in: (field: string, values: unknown[]) => { rows = rows.filter(row => values.some(value => String(value).toLowerCase() === String(pathValue(row, field)).toLowerCase())); return query; },
        lt: (field: string, value: string) => { rows = rows.filter(row => String(pathValue(row, field)) < value); return query; },
        order: (field: string, options?: { ascending?: boolean }) => { rows = [...rows].sort((a, b) => String(a[field] || "").localeCompare(String(b[field] || "")) * (options?.ascending === false ? -1 : 1)); return query; },
        limit: async (count: number) => ({ data: rows.slice(0, count).map(project), error: null }),
        range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1).map(project), error: null }),
      };
      return query;
    } } as unknown as DatabaseClient;

    const context = JSON.parse(await loadAnalysisContext(db, "owner", { id: "sport", slug: "tennis" }, "종료된 경기 결과를 확인하고 오답노트를 작성해줘", {
      kind: "review_results", now: new Date("2026-10-14T16:00:00Z"),
    }));
    expect(context.analysis_scope).toMatchObject({ date_et: "2026-09-30", basis: "previous", parent_message_id: "parent" });
    expect(context.recent_messages.map((row: { id: string }) => row.id)).toContain("parent");
    expect(context.recent_messages.map((row: { id: string }) => row.id)).toContain("same-date");
    expect(context.recent_messages.map((row: { id: string }) => row.id)).not.toContain("other-date");
    expect(context.recent_messages.map((row: { id: string }) => row.id)).not.toContain("invalid-scope");
    expect(context.recent_messages.map((row: { id: string }) => row.id)).not.toContain("foreign-owner");
    expect(context.recent_messages.map((row: { id: string }) => row.id)).not.toContain("foreign-sport");
    expect(context.recent_messages.map((row: { id: string }) => row.id)).not.toContain("future");
    expect(context.recent_messages.map((row: { id: string }) => row.id)).not.toContain("other-date");
    expect(context).not.toHaveProperty("omitted_messages");
  });

  it("disables pruning and marks incomplete history when the review source cap is reached", async () => {
    const sources = Array.from({ length: 501 }, (_, index) => ({
      id: `source-${String(index).padStart(3, "0")}`, owner_id: "owner", sport_id: "sport", role: "assistant",
      created_at: new Date(Date.parse("2026-10-01T00:00:00Z") - index * 1000).toISOString(), content: `source-${index}`,
      metadata: { coverage: { status: "complete", scope: { version: 1, sport: "tennis", date_et: "2026-09-30", timezone: "America/New_York", mode: "explicit", competitions: ["ATP"], basis: "request" } } },
    }));
    const db = { from(table: string) {
      let rows: Record<string, unknown>[] = table === "messages" ? sources : [];
      let projection = "*";
      const project = (row: Record<string, unknown>) => projection === "id,role,created_at,coverage:metadata->coverage"
        ? { id: row.id, role: row.role, created_at: row.created_at, coverage: pathValue(row, "metadata->coverage") } : row;
      const query: ReviewTestQuery = {
        select: (fields = "*") => { projection = fields; return query; },
        eq: (field: string, value: unknown) => { rows = rows.filter(row => pathValue(row, field) === value); return query; },
        in: (field: string, values: unknown[]) => { rows = rows.filter(row => values.includes(pathValue(row, field))); return query; },
        lt: (field: string, value: string) => { rows = rows.filter(row => String(pathValue(row, field)) < value); return query; },
        order: (field: string, options?: { ascending?: boolean }) => { rows = [...rows].sort((a, b) => String(a[field] || "").localeCompare(String(b[field] || "")) * (options?.ascending === false ? -1 : 1)); return query; },
        limit: async (count: number) => ({ data: rows.slice(0, count).map(project), error: null }),
        range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1).map(project), error: null }),
      };
      return query;
    } } as unknown as DatabaseClient;
    const context = JSON.parse(await loadAnalysisContext(db, "owner", { id: "sport", slug: "tennis" }, "종료된 경기 결과 확인", {
      kind: "review_results", now: new Date("2026-10-14T16:00:00Z"), requestCreatedAt: "2026-10-14T15:00:00Z",
    }));
    expect(context.scope_limitations).toContain("review_source_history_incomplete");
    expect(context.recent_messages.length).toBeLessThanOrEqual(33);
    expect(context.recent_messages.filter((row: { id: string }) => row.id.startsWith("source-")).length).toBeLessThanOrEqual(33);
    expect(context).not.toHaveProperty("omitted_messages");
  });

  it.each([[32, false], [33, true]])("limits automatic same-date source pinning to 32 rows (count=%i)", async (count, incomplete) => {
    const sources = Array.from({ length: count as number }, (_, index) => ({
      id: `source-${String(index).padStart(3, "0")}`, owner_id: "owner", sport_id: "sport", role: "assistant",
      created_at: new Date(Date.parse("2026-10-01T00:00:00Z") - index * 1000).toISOString(), content: `source-${index}`,
      metadata: { coverage: { status: "complete", scope: { version: 1, sport: "tennis", date_et: "2026-09-30", timezone: "America/New_York", mode: "explicit", competitions: ["ATP"], basis: "request" } } },
    }));
    const db = { from(table: string) {
      let rows: Record<string, unknown>[] = table === "messages" ? sources : [];
      let projection = "*";
      const project = (row: Record<string, unknown>) => projection === "id,role,created_at,coverage:metadata->coverage"
        ? { id: row.id, role: row.role, created_at: row.created_at, coverage: pathValue(row, "metadata->coverage") } : row;
      const query: ReviewTestQuery = {
        select: (fields = "*") => { projection = fields; return query; },
        eq: (field: string, value: unknown) => { rows = rows.filter(row => pathValue(row, field) === value); return query; },
        in: (field: string, values: unknown[]) => { rows = rows.filter(row => values.includes(pathValue(row, field))); return query; },
        lt: (field: string, value: string) => { rows = rows.filter(row => String(pathValue(row, field)) < value); return query; },
        order: (field: string, options?: { ascending?: boolean }) => { rows = [...rows].sort((a, b) => String(a[field] || "").localeCompare(String(b[field] || "")) * (options?.ascending === false ? -1 : 1)); return query; },
        limit: async (limit: number) => ({ data: rows.slice(0, limit).map(project), error: null }),
        range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1).map(project), error: null }),
      };
      return query;
    } } as unknown as DatabaseClient;
    const context = JSON.parse(await loadAnalysisContext(db, "owner", { id: "sport", slug: "tennis" }, "종료된 경기 결과 확인", {
      kind: "review_results", now: new Date("2026-10-14T16:00:00Z"), requestCreatedAt: "2026-10-14T15:00:00Z",
    }));
    expect(context.scope_limitations.includes("review_source_history_incomplete")).toBe(incomplete);
    expect(context.recent_messages.length).toBeLessThanOrEqual(33);
    if (incomplete) expect(context).not.toHaveProperty("omitted_messages");
  });

  it("loads an explicitly referenced assistant report beyond the recent window within owner, sport and cutoff", async () => {
    const pinnedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const olderPinnedId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const otherOwnerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const otherSportId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const futureId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const messages = [
      { id: olderPinnedId, owner_id: "owner", sport_id: "sport", role: "assistant", created_at: "2026-09-30T00:00:00Z", content: "older referenced" },
      { id: pinnedId, owner_id: "owner", sport_id: "sport", role: "assistant", created_at: "2026-10-01T00:00:00Z", content: "referenced" },
      ...Array.from({ length: 34 }, (_, index) => ({ id: `recent-${index}`, owner_id: "owner", sport_id: "sport", role: "assistant", created_at: new Date(Date.parse("2026-10-02T00:00:00Z") + index * 6 * 60 * 60 * 1000).toISOString(), content: "recent" })),
      { id: otherOwnerId, owner_id: "other", sport_id: "sport", role: "assistant", created_at: "2026-10-01T00:00:00Z", content: "foreign" },
      { id: otherSportId, owner_id: "owner", sport_id: "other", role: "assistant", created_at: "2026-10-01T00:00:00Z", content: "foreign" },
      { id: futureId, owner_id: "owner", sport_id: "sport", role: "assistant", created_at: "2026-10-14T16:00:00Z", content: "future" },
    ];
    const pinnedQueryCalls: unknown[][] = [];
    const db = { from(table: string) {
      let rows: Record<string, unknown>[] = table === "messages" ? messages : [];
      let order = "created_at";
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => { if (table === "messages") pinnedQueryCalls.push([field, value]); rows = rows.filter(row => row[field] === value); return query; },
        in: (field: string, values: unknown[]) => { if (table === "messages") pinnedQueryCalls.push([field, values]); rows = rows.filter(row => values.some(value => String(value).toLowerCase() === String(row[field]).toLowerCase())); return query; },
        order: (field: string) => { order = field; return query; },
        lt: (field: string, value: string) => { if (table === "messages") pinnedQueryCalls.push(["lt", field, value]); rows = rows.filter(row => String(row[field]) < value); return query; },
        limit: async (count: number) => ({ data: [...rows].sort((a, b) => String(b[order] || "").localeCompare(String(a[order] || ""))).slice(0, count), error: null }),
      };
      return query;
    } } as unknown as DatabaseClient;

    const result = JSON.parse(await loadAnalysisContext(db, "owner", { id: "sport", slug: "tennis" }, `2026-10-13 결과 회고 ${pinnedId.toUpperCase()} ${olderPinnedId.toUpperCase()} ${otherOwnerId} ${otherSportId} ${futureId}`, {
      kind: "review_results", now: new Date("2026-10-14T16:00:00Z"), requestCreatedAt: "2026-10-14T15:00:00Z",
    }));
    expect(result.recent_messages.map((row: { id: string }) => row.id)).toContain(pinnedId);
    expect(result.recent_messages.map((row: { id: string }) => row.id)).toContain(olderPinnedId);
    expect(result.recent_messages.findIndex((row: { id: string }) => row.id === olderPinnedId)).toBeLessThan(result.recent_messages.findIndex((row: { id: string }) => row.id === pinnedId));
    expect(result.recent_messages.map((row: { id: string }) => row.id)).not.toContain(otherOwnerId);
    expect(result.recent_messages.map((row: { id: string }) => row.id)).not.toContain(otherSportId);
    expect(result.recent_messages.map((row: { id: string }) => row.id)).not.toContain(futureId);
    expect(pinnedQueryCalls).toContainEqual(["owner_id", "owner"]);
    expect(pinnedQueryCalls).toContainEqual(["sport_id", "sport"]);
    expect(pinnedQueryCalls).toContainEqual(["role", "assistant"]);
    expect(pinnedQueryCalls).toContainEqual(["id", [pinnedId, olderPinnedId, otherOwnerId, otherSportId, futureId]]);
    expect(pinnedQueryCalls).toContainEqual(["lt", "created_at", "2026-10-14T15:00:00Z"]);
  });

  it("loads referenced purpose/hash and bounded original excerpts while retaining previous scope metadata", async () => {
    const tables: Record<string, Record<string, unknown>[]> = {
      criteria_versions: [{ id: "c", owner_id: "owner", sport_id: "sport", status: "adopted", source_document_id: "doc" }],
      imported_documents: [{ id: "doc", owner_id: "owner", sport_id: "sport", sha256: "a".repeat(64), raw_text: "## Purpose\nDiscover all games\n## Picks\nold private picks", imported_at: "2026-09-29" }],
      messages: [{ id: "old", owner_id: "owner", sport_id: "sport", role: "assistant", created_at: "2026-09-29T09:00:00Z", metadata: { coverage: { status: "unverified", scope: { version: 1, sport: "mlb", date_et: "2026-09-29", timezone: "America/New_York", mode: "daily", competitions: ["MLB"], basis: "default" } }, original_model_response: "huge raw response" } }],
    };
    const db = { from(table: string) {
      let rows = tables[table] || []; const query = { select: () => query, eq: (key: string, value: unknown) => { rows = rows.filter(r => r[key] === value); return query; }, in: (key: string, values: unknown[]) => { rows = rows.filter(r => values.includes(r[key])); return query; }, order: () => query, lt: (key: string, value: string) => { rows = rows.filter(r => String(r[key]) < value); return query; }, limit: async (count: number) => ({ data: rows.slice(0, count), error: null }) }; return query;
    } } as unknown as DatabaseClient;
    const result = JSON.parse(await loadAnalysisContext(db, "owner", { id: "sport", slug: "mlb" }, "재확인", { kind: "recheck_lineup", now: new Date("2026-09-30T12:00:00Z"), requestCreatedAt: "2026-09-30T11:00:00Z" }));
    expect(result.document_purposes).toEqual([expect.objectContaining({ source_document_id: "doc", sha256: "a".repeat(64), purpose: "Discover all games", source_ref: "L1-L2" })]);
    expect(result.document_sources).toEqual([{ source_document_id: "doc", sha256: "a".repeat(64) }]);
    expect(result.analysis_scope).toMatchObject({ date_et: "2026-09-29", parent_message_id: "old" });
    expect(JSON.stringify(result.historical_document_excerpts)).toContain("old private picks");
    expect(result.historical_source_authority).toContain("historical evidence only"); expect(JSON.stringify(result)).not.toContain("huge raw response");
  });

  it("loads adopted criteria before applying the row limit", async () => {
    const criteria = [
      { id: "old-adopted", owner_id: "owner", sport_id: "sport", status: "adopted", content: "오래된 채택 기준", created_at: 0 },
      ...Array.from({ length: 101 }, (_, index) => ({
        id: `proposal-${index}`,
        owner_id: "owner",
        sport_id: "sport",
        status: "proposed",
        content: "제안",
        created_at: index + 1,
      })),
    ];
    const db = {
      from(table: string) {
        let rows: Record<string, unknown>[] = table === "criteria_versions" ? criteria : [];
        let order = "created_at";
        const query = {
          select: () => query,
          lt: () => query,
          eq: (field: string, value: unknown) => {
            rows = rows.filter((row) => row[field] === value);
            return query;
          },
          order: (field: string) => {
            order = field;
            return query;
          },
          limit: async (count: number) => ({
            data: [...rows]
              .sort((a, b) => Number(b[order]) - Number(a[order]))
              .slice(0, count),
            error: null,
          }),
        };
        return query;
      },
    } as unknown as DatabaseClient;

    const context = JSON.parse(
      await loadAnalysisContext(db, "owner", { id: "sport", slug: "mlb" }, "분석"),
    );
    expect(context.adopted_criteria).toEqual([
      expect.objectContaining({ id: "old-adopted", content: "오래된 채택 기준" }),
    ]);
  });
});

it("finds historic acknowledgments within the exact owner, sport, and request namespace",async () => {
 const calls:unknown[]=[]; const query={select:(value:string)=>{calls.push(["select",value]);return query;},eq:(field:string,value:string)=>{calls.push([field,value]);return query;},maybeSingle:async()=>({data:{request_key:"key"},error:null})};
 const db={from:(table:string)=>{calls.push(table);return query;}} as unknown as DatabaseClient;
 expect(await findLocalConversationRequest(db,"owner","sport","key")).toEqual({request_key:"key"});
 expect(calls).toEqual(["local_conversation_requests",["select","request_key"],["owner_id","owner"],["sport_id","sport"],["request_key","key"]]);
});

it("retains original user corrections beyond assistant volume and reports bounded history", async () => {
  const rows = [
    {id:"correction",role:"user",content:"Earlier summary is wrong; exposure is 1U.",created_at:"2026-10-01T00:00:00Z",owner_id:"owner",sport_id:"sport"},
    ...Array.from({length:40},(_,i)=>({id:`assistant-${i}`,role:"assistant",content:"report",created_at:`2026-10-02T00:00:${String(i).padStart(2,"0")}Z`,owner_id:"owner",sport_id:"sport"})),
    {id:"future",role:"user",content:"future",created_at:"2026-11-01T00:00:00Z",owner_id:"owner",sport_id:"sport"},
    {id:"foreign",role:"user",content:"private",created_at:"2026-10-01T00:00:00Z",owner_id:"other",sport_id:"sport"},
  ];
  const db={from(table:string){let selected=table==="messages"?[...rows]:[];const q={select:()=>q,eq:(key:string,value:unknown)=>{selected=selected.filter(r=>r[key as keyof typeof r]===value);return q;},lt:(key:string,value:string)=>{selected=selected.filter(r=>String(r[key as keyof typeof r])<value);return q;},order:(key:string)=>{selected.sort((a,b)=>String(b[key as keyof typeof b]).localeCompare(String(a[key as keyof typeof a])));return q;},limit:async(n:number)=>({data:selected.slice(0,n),error:null})};return q;}} as unknown as DatabaseClient;
  const c=JSON.parse(await loadAnalysisContext(db,"owner",{id:"sport",slug:"mlb"},"continue",{kind:"message",requestCreatedAt:"2026-10-27T12:00:00Z"}));
  expect(c.recent_messages.find((r:{id:string})=>r.id==="correction")).toMatchObject({content:rows[0].content,created_at:rows[0].created_at});
  expect(c.recent_messages.map((r:{id:string})=>r.id)).not.toContain("future");
  expect(c.recent_messages.map((r:{id:string})=>r.id)).not.toContain("foreign");
  expect(c.user_history_coverage).toMatchObject({limit:100,returned:1,truncated:false,before:"2026-10-27T12:00:00Z"});
  expect(c.user_history_coverage.source_message_ids).toEqual(["correction"]);
});

it("reports the original-user cap and never silently truncates original content", async () => {
  const all = Array.from({length:105}, (_,i)=>({id:`u${String(i).padStart(3,"0")}`, role:"user", content:`Original ${i}`, created_at:"2026-10-01T00:00:00Z", owner_id:"owner", sport_id:"sport"}));
  const db={from(table:string){let rows:Record<string,unknown>[]=table==="messages"?[...all]:[];const q={select:()=>q,eq:(k:string,v:unknown)=>{rows=rows.filter(r=>r[k]===v);return q;},lt:(k:string,v:string)=>{rows=rows.filter(r=>String(r[k])<v);return q;},order:(k:string)=>{rows.sort((a,b)=>String(b[k]).localeCompare(String(a[k])));return q;},limit:async(n:number)=>({data:rows.slice(0,n),error:null})};return q;}} as unknown as DatabaseClient;
  const context=JSON.parse(await loadAnalysisContext(db,"owner",{id:"sport",slug:"mlb"},"continue",{kind:"message",now:new Date("2026-10-27T12:00:00Z")}));
  expect(context.user_history_coverage).toMatchObject({limit:100,returned:100,truncated:true});
  expect(context.user_history_coverage.source_message_ids).toHaveLength(100);
  expect(context.user_history_coverage.source_message_ids).not.toContain("u000");
  expect(context.recent_messages.find((r:{id:string})=>r.id==="u104").content).toBe("Original 104");
});

it("retrieves a raw-only NBA import with owner/sport/request-time isolation", async () => {
 const raw="# NBA notes\nUnique rotation rule: bench minutes require separate review.\nUser reported no actual tickets.";
 const docs=[{id:"nba-raw",owner_id:"owner",sport_id:"sport",sha256:"b".repeat(64),raw_text:raw,imported_at:"2026-10-01T00:00:00Z"},{id:"foreign",owner_id:"other",sport_id:"sport",sha256:"c".repeat(64),raw_text:"foreign-private",imported_at:"2026-10-02T00:00:00Z"},{id:"other-sport",owner_id:"owner",sport_id:"wnba",sha256:"d".repeat(64),raw_text:"WNBA-private",imported_at:"2026-10-02T00:00:00Z"},{id:"future",owner_id:"owner",sport_id:"sport",sha256:"e".repeat(64),raw_text:"future-private",imported_at:"2026-10-28T00:00:00Z"}];
 const db={from(table:string){let rows:Record<string,unknown>[]=table==="imported_documents"?[...docs]:[];const q={select:()=>q,eq:(k:string,v:unknown)=>{rows=rows.filter(r=>r[k]===v);return q;},lt:(k:string,v:string)=>{rows=rows.filter(r=>String(r[k])<v);return q;},order:(k:string)=>{rows.sort((a,b)=>String(b[k]).localeCompare(String(a[k])));return q;},limit:async(n:number)=>({data:rows.slice(0,n),error:null})};return q;}} as unknown as DatabaseClient;
 const context=JSON.parse(await loadAnalysisContext(db,"owner",{id:"sport",slug:"nba"},"continue rotation discussion",{kind:"message",requestCreatedAt:"2026-10-27T12:00:00Z"}));
 expect(context.historical_document_excerpts.documents[0]).toMatchObject({source_document_id:"nba-raw",sha256:"b".repeat(64),truncated:false});
 expect(JSON.stringify(context.historical_document_excerpts)).toContain("Unique rotation rule");
 expect(JSON.stringify(context)).not.toMatch(/foreign-private|WNBA-private|future-private/);
 expect(context.confirmed_bets).toEqual([]);expect(context.adopted_criteria).toEqual([]);
 expect(docs[0].raw_text).toBe(raw);
});

it("loads owned review tickets and recommendations beyond recent30 through exact source and event identity", async () => {
  const scope = { version: 1, sport: "tennis", date_et: "2026-10-28", timezone: "America/New_York", mode: "explicit", competitions: ["ATP"], basis: "request" };
  const base = { owner_id: "owner", sport_id: "sport", created_at: "2026-10-01T00:00:00Z" };
  const tables: Record<string, Record<string, unknown>[]> = {
    messages: [{ ...base, id: "parent", role: "assistant", content: "GO Alpha, PASS Beta, WAIT Gamma, unstructured Delta", metadata: { coverage: { status: "complete", scope }, coverage_report: { inventory: [{ event_key: "tennis:2026-10-28:alpha@beta:id-123" }] }, analysis_record: { events: [{ event_key: "tennis:2026-10-28:gamma@delta:src-knownhash" }] } } }],
    recommendations: [{ ...base, id: "old-rec", source_message_id: "parent", event_id: "old-event", decision: "PASS" }, ...Array.from({ length: 31 }, (_, i) => ({ ...base, id: `new-rec-${i}`, source_message_id: "other", created_at: "2026-10-29T00:00:00Z" }))],
    events: [{ ...base, id: "body-only-event", event_key: "tennis:2026-10-28:gamma@delta:src-knownhash", updated_at: "2026-10-01T00:00:00Z" }, { ...base, id: "old-event", event_key: "tennis:2026-10-28:alpha@beta:id-123", updated_at: "2026-10-01T00:00:00Z" }, ...Array.from({ length: 31 }, (_, i) => ({ ...base, id: `new-event-${i}`, updated_at: "2026-10-29T00:00:00Z" }))],
    bets: [{ ...base, id: "body-only-bet", event_id: "body-only-event", result: "lost", stake_units: 1, executed_price: 100 }, { ...base, id: "old-bet", source_message_id: "user-actual", source_recommendation_id: "old-rec", event_id: "old-event", result: "won", stake_units: 2, executed_price: 150 }, { ...base, id: "foreign-bet", owner_id: "foreign", event_id: "old-event" }, ...Array.from({ length: 31 }, (_, i) => ({ ...base, id: `new-bet-${i}`, event_id: "other", created_at: "2026-10-29T00:00:00Z" }))],
  };
  const db = { from(table: string) {
    let data = tables[table] || []; let projection = "*";
    const query: ReviewTestQuery = {
      select: (fields = "*") => { projection = fields; return query; },
      eq: (field, value) => { data = data.filter(row => pathValue(row, field) === value); return query; },
      in: (field, values) => { data = data.filter(row => values.includes(pathValue(row, field))); return query; },
      lt: (field, value) => { data = data.filter(row => String(pathValue(row, field)) < value); return query; },
      order: (field) => { data = [...data].sort((a, b) => String(b[field] || "").localeCompare(String(a[field] || ""))); return query; },
      limit: async count => ({ data: data.slice(0, count), error: null }),
      range: async (from, to) => ({ data: data.slice(from, to + 1).map(row => projection === "id,role,created_at,coverage:metadata->coverage" ? { ...row, coverage: pathValue(row, "metadata->coverage") } : row), error: null }),
    }; return query;
  } } as unknown as DatabaseClient;
  const context = JSON.parse(await loadAnalysisContext(db, "owner", { id: "sport", slug: "tennis" }, "2026-10-28 결과 회고", { kind: "review_results", now: new Date("2026-10-29T16:00:00Z") }));
  expect(context.relevant_recommendations.some((row: { id: string }) => row.id === "old-rec")).toBe(true);
  expect(context.active_events.some((row: { id: string }) => row.id === "old-event")).toBe(true);
  expect(context.confirmed_bets.some((row: { id: string }) => row.id === "old-bet")).toBe(true);
  expect(context.confirmed_bets.some((row: { id: string }) => row.id === "body-only-bet")).toBe(true);
  expect(context.confirmed_bets.some((row: { id: string }) => row.id === "foreign-bet")).toBe(false);
  expect(context.review_ledger_coverage).toMatchObject({ complete_ledger: false, source_message_ids: ["parent"], exact_source_and_event_queries: true });
});
