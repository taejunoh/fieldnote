import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadAnalysisContext, sportSlugs, type DatabaseClient } from "./data";
import { extractAnalysisRecord } from "./record";
import { GatewayError, type GatewayOptions, type GatewayResult } from "./gateway";
import { runOnce, type ClaimedJob, type WorkerStore } from "./worker";

const body = `공통 원문\nFull Agreement 제한 폐기\nEARLY에도 동일한 등급\n${"원문 보충 항목과 공백을 그대로 보존한다.\n".repeat(1000)}마지막 보충 문장`;
const policy = { id: "policy-1", owner_id: "owner", title: "공통 운영 기준", version_date: "2026-10-06", content: body, content_hash: createHash("sha256").update(body).digest("hex"), status: "adopted", supersedes_id: null, created_at: "2026-10-06T12:00:00Z" };
const policyRef = { id: policy.id, version_date: policy.version_date, content_hash: policy.content_hash };

function database(common: Record<string, unknown>[] = [policy], extraTables: Record<string, Record<string, unknown>[]> = {}) {
  return { from(table: string) {
    let rows: Record<string, unknown>[] = extraTables[table] || (table === "common_policy_versions" ? common : table === "criteria_versions" ? [{ id: "supplement", owner_id: "owner", sport_id: "sport", status: "adopted", content: "B+ 0.25U 상한", created_at: "2026-10-01" }] : []);
    const query = { select: () => query, lt: (key: string, value: string) => { rows = rows.filter(row => String(row[key]) < value); return query; }, eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query; }, in: (key: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[key])); return query; }, order: () => query, limit: async (count: number) => ({ data: rows.slice(0, count), error: null }) };
    return query;
  } } as unknown as DatabaseClient;
}

describe("shared adopted operating policy context", () => {
  it.each(sportSlugs)("supplies the exact owner-global revision once for %s, apart from sport supplements", async slug => {
    const context = JSON.parse(await loadAnalysisContext(database([policy, { ...policy, owner_id: "other", id: "foreign" }, { ...policy, status: "superseded", id: "old" }]), "owner", { id: "sport", slug }, "설명해줘", { kind: "message" }));
    expect(context.common_operating_policy).toMatchObject({ ...policy, evidence_type: "adopted owner-global operating policy; not a source of current sports facts" });
    expect(context.adopted_criteria).toEqual([expect.objectContaining({ id: "supplement", content: "B+ 0.25U 상한" })]);
    expect(JSON.stringify(context).split("마지막 보충 문장")).toHaveLength(2);
    expect(context.authority_order).toContain("Current explicit user instructions > adopted common operating policy > current-sport analytical supplements > historical summaries and provisional hypotheses");
    expect(context.policy_application).toContain("exposure limits");
    expect(context.policy_application).toContain("settlement");
    expect(context.policy_application).toContain("unavailable");
    expect(JSON.stringify(context)).not.toContain("foreign");
  });

  it("reports absent common policy explicitly and rejects multiple adopted owner revisions", async () => {
    expect(JSON.parse(await loadAnalysisContext(database([]), "owner", { id: "sport", slug: "mlb" }, "분석")).common_operating_policy).toBeNull();
    await expect(loadAnalysisContext(database([policy, { ...policy, id: "second" }]), "owner", { id: "sport", slug: "mlb" }, "분석")).rejects.toThrow("Multiple adopted common operating policies");
  });

  it("retains EARLY timing and independent LEAN notes after the source message leaves recent context", async () => {
    const rows = {
      recommendations: [{ id: "rec-early", owner_id: "owner", sport_id: "sport", decision: "BET", suggested_units: 1, source_message_id: "archived", recommendation_item_key: "early" }, { id: "rec-wait", owner_id: "owner", sport_id: "sport", decision: "WAIT", suggested_units: null, source_message_id: "archived", recommendation_item_key: "waiting" }],
      messages: [...Array.from({ length: 32 }, (_, n) => ({ id: `recent-${n}`, owner_id: "owner", sport_id: "sport", content: "Recent unrelated conversation" })), { id: "archived", owner_id: "owner", sport_id: "sport", metadata: { analysis_record: { recommendations: [{ item_key: "early", timing: "early", decision: "BET" }, { item_key: "waiting", direction_note: "Boston direction awaiting lineup", decision: "WAIT" }] } } }, { id: "archived", owner_id: "other", sport_id: "sport", metadata: { analysis_record: { recommendations: [{ item_key: "early", direction_note: "foreign note" }] } } }],
      bets: [{ id: "actual", owner_id: "owner", sport_id: "sport", stake_units: 3.75, executed_price: "-117" }],
    };
    const context = JSON.parse(await loadAnalysisContext(database([policy], rows), "owner", { id: "sport", slug: "mlb" }, "재확인"));
    expect(context.recent_messages).toHaveLength(32);
    expect(context.recent_messages.map((row: { id: string }) => row.id)).not.toContain("archived");
    expect(context.relevant_recommendations).toEqual([expect.objectContaining({ id: "rec-early", decision: "BET", suggested_units: 1, timing: "early" }), expect.objectContaining({ id: "rec-wait", decision: "WAIT", direction_note: "Boston direction awaiting lineup" })]);
    expect(context.confirmed_bets[0]).toMatchObject({ stake_units: 3.75, executed_price: "-117" });
    expect(JSON.stringify(context)).not.toContain("foreign note");
  });
});

const checkedAt = new Date("2026-10-06T12:00:00Z");
const source = { title: "MLB", url: "https://www.mlb.com/game/123" };
function record(decision: string, units: number | null, startsAt: string | null = "2026-10-06T18:00:00Z") {
  return { version: 1, sport: "mlb", events: [{ event_key: "mlb:2026-10-06:bos@nyy:id-123", label: "Boston at New York", starts_at: startsAt, source_url: source.url, analysis_status: decision }], recommendations: [{ item_key: "main", event_key: "mlb:2026-10-06:bos@nyy:id-123", market: "ML", selection: "Boston", decision, suggested_units: units, price_gate: "-110" }] };
}
const wrapped = (value: unknown) => `분석 [출처](${source.url})\n\n\`\`\`analysis-record\n${JSON.stringify(value)}\n\`\`\``;
const extract = (value: unknown, sources = [source]) => extractAnalysisRecord(wrapped(value), "mlb", sources, checkedAt, { commonPolicyAdopted: true });

describe("common policy recommendation semantics", () => {
  it.each([0.25, 0.5, 1, 2])("normalizes GO and EARLY GO at %s risk units without actual entry fields", units => {
    const regular = extract(record("GO", units));
    const early = extract(record("EARLY GO", units));
    expect(regular.record?.recommendations[0]).toMatchObject({ decision: "BET", suggested_units: units });
    expect(early.record?.recommendations[0]).toMatchObject({ decision: "BET", suggested_units: units, timing: "early" });
    expect(early.record?.events[0].analysis_status).toBe("BET");
    expect(early.record?.recommendations[0]).not.toHaveProperty("entry_confirmed_at");
    expect(early.record?.recommendations[0]).not.toHaveProperty("stake_units");
  });

  it.each([null, 0, 0.1, 0.75, 3, 100])("rejects new BET recommendation risk grade %s", units => {
    expect(extract(record("BET", units))).toMatchObject({ status: "incomplete", failure: { code: "invalid_recommended_units" } });
  });

  it("separates pregame incomplete, conditional WAIT, price PASS and LEAN direction notes", () => {
    expect(extract(record("EVALUATION INCOMPLETE", null)).record?.recommendations[0].decision).toBe("EVALUATION INCOMPLETE");
    expect(extract(record("EVALUATION INCOMPLETE", null, null)).record?.events[0].analysis_status).toBe("EVALUATION INCOMPLETE");
    for (const decision of ["WAIT", "PASS"]) expect(extract(record(decision, 0)).record?.recommendations[0].decision).toBe(decision);
    expect(extract(record("LEAN", null)).record?.recommendations[0]).toMatchObject({ decision: "WATCH", direction_note: "Boston", suggested_units: null });
    const waiting = record("WAIT", null);
    expect(extract({ ...waiting, recommendations: [{ ...waiting.recommendations[0], direction_note: "Boston 방향, 선발 확인 대기" }] }).record?.recommendations[0]).toMatchObject({ decision: "WAIT", direction_note: "Boston 방향, 선발 확인 대기" });
    expect(extract(record("WAIT", 0.5))).toMatchObject({ failure: { code: "non_entry_units" } });
    expect(extract({ ...waiting, recommendations: [{ ...waiting.recommendations[0], timing: "early" }] })).toMatchObject({ failure: { code: "invalid_early_timing" } });
  });

  it("preserves legacy grades and enforces source, time and actual-entry guards under the common policy", () => {
    expect(extractAnalysisRecord(wrapped(record("BET", 0.75)), "mlb", [source], checkedAt).record?.recommendations[0].suggested_units).toBe(0.75);
    expect(extract(record("GO", 1, "2026-10-06T11:00:00Z"))).toMatchObject({ failure: { code: "invalid_bet_timing" } });
    expect(extract(record("GO", 1, null))).toMatchObject({ failure: { code: "invalid_bet_timing" } });
    expect(extract(record("GO", 1), [])).toMatchObject({ failure: { code: "unverified_source" } });
    const actual = record("GO", 1);
    expect(extract({ ...actual, recommendations: [{ ...actual.recommendations[0], entry_confirmed_at: checkedAt.toISOString() }] })).toMatchObject({ failure: { code: "schema_invalid" } });
  });
});

const job: ClaimedJob = { id: "job", owner_id: "owner", sport_id: "sport", user_message_id: "user-message", kind: "analyze_today", model: "gpt-6-astra", effort: "xhigh", current_attempt_id: "attempt-1" };
function workerStore(): WorkerStore {
  return { loadCompletion: vi.fn().mockResolvedValue(null), saveCompletion: vi.fn().mockResolvedValue(true), claim: vi.fn().mockResolvedValue(job), context: vi.fn().mockResolvedValue(JSON.stringify({ sport: "mlb", common_operating_policy: policy, new_request: "분석" })), heartbeat: vi.fn().mockResolvedValue(true), saveInputSnapshot: vi.fn().mockResolvedValue(true), finalize: vi.fn().mockResolvedValue("message"), finalizeConversation: vi.fn().mockResolvedValue("message"), fail: vi.fn().mockResolvedValue(true), summarize: vi.fn() };
}
const result: GatewayResult = { text: wrapped(record("GO", 1)), sources: [source], searched: true, verified: true, upstreamResponseId: "response", usage: { inputTokens: 100, outputTokens: 100 } };
const execute = (store: WorkerStore, gateway: (options: GatewayOptions) => Promise<GatewayResult>) => runOnce({ store, gateway, workerId: "worker", baseUrl: "https://gateway.example", apiKey: "secret", expectedModel: "gpt-6-astra", now: () => checkedAt });

describe("attempt policy provenance", () => {
  it("captures one current revision, keeps it fixed in flight, and selects a new revision on explicit retry", async () => {
    const store = workerStore();
    const next = { ...policy, id: "policy-2", version_date: "2026-10-07", content: "수정 기준", content_hash: createHash("sha256").update("수정 기준").digest("hex") };
    await execute(store, async () => { store.context = vi.fn().mockResolvedValue(JSON.stringify({ sport: "mlb", common_operating_policy: next })); return result; });
    const firstSnapshot = vi.mocked(store.saveInputSnapshot).mock.calls[0][3];
    const firstAudit = vi.mocked(store.finalize).mock.calls[0][4];
    expect(firstSnapshot).toMatchObject({ common_policy: policyRef, context: expect.stringContaining("마지막 보충 문장") });
    expect(firstAudit).toMatchObject({ common_policy: policyRef, input_snapshot: { common_policy: policyRef }, analysis_record: { recommendations: [{ decision: "BET", suggested_units: 1 }] } });
    expect(firstSnapshot.instructions).not.toContain("경기 시작 전/미확인에 EVALUATION INCOMPLETE를 쓰지 않는다");
    expect(firstSnapshot.instructions).not.toContain("EVALUATION INCOMPLETE는 확인된 시작 시각이 이미 지났을 때만 쓴다");
    vi.mocked(store.claim).mockResolvedValue({ ...job, current_attempt_id: "attempt-2" });
    await execute(store, async () => result);
    expect(vi.mocked(store.saveInputSnapshot).mock.calls[1][3]).toMatchObject({ attempt_id: "attempt-2", common_policy: { id: "policy-2", version_date: "2026-10-07", content_hash: next.content_hash } });
    expect(firstSnapshot.common_policy).toEqual(policyRef);
    expect(firstAudit.common_policy).toEqual(policyRef);
  });

  it.each(["interrupted", "source_failure", "snapshot_failure", "conversation", "clarification", "fresh_clarification"])("records common revision for the %s terminal path", async path => {
    const store = workerStore();
    if (path === "snapshot_failure") vi.mocked(store.saveInputSnapshot).mockRejectedValue(new Error("storage"));
    if (["conversation", "clarification", "fresh_clarification"].includes(path)) {
      vi.mocked(store.claim).mockResolvedValue({ ...job, kind: "message" });
      vi.mocked(store.context).mockResolvedValue(JSON.stringify({ sport: "mlb", common_operating_policy: policy, new_request: path === "fresh_clarification" ? "오늘 MLB 최신 일정 확인" : "이전 기준 설명", recent_messages: [] }));
    }
    await execute(store, async () => {
      if (path === "interrupted") throw new GatewayError("upstream_interrupted", "interrupted");
      if (path === "source_failure") return { ...result, sources: [], verified: false, searched: false };
      if (path === "conversation") return { ...result, text: '기준 설명\n```response-purpose\n{"version":1,"intent":"conversation","basis":"general","referenced_message_ids":[],"requires_fresh_data":false}\n```', sources: [], searched: false, verified: false };
      if (path === "fresh_clarification") return { ...result, text: '기준 설명\n```response-purpose\n{"version":1,"intent":"conversation","basis":"general","referenced_message_ids":[],"requires_fresh_data":false}\n```' };
      if (path === "clarification") return { ...result, text: "계약 미완료", sources: [], searched: false, verified: false };
      return result;
    });
    const metadata = ["conversation", "clarification", "fresh_clarification"].includes(path) ? vi.mocked(store.finalizeConversation).mock.calls[0][4] : vi.mocked(store.fail).mock.calls[0][5];
    expect(metadata).toMatchObject({ common_policy: policyRef });
  });

  it("records an explicit null when the execution has no adopted common revision", async () => {
    const store = workerStore(); vi.mocked(store.context).mockResolvedValue('{"sport":"mlb","common_operating_policy":null}');
    await execute(store, async () => ({ ...result, text: wrapped(record("WAIT", null)) }));
    expect(vi.mocked(store.saveInputSnapshot).mock.calls[0][3].common_policy).toBeNull();
    expect(vi.mocked(store.finalize).mock.calls[0][4].common_policy).toBeNull();
  });
});
