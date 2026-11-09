import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  getOrCreateSport: vi.fn(),
  findLocalConversationRequest: vi.fn(),
  isSportSlug: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  requireOwner: mocks.requireOwner,
  apiError: (error: unknown) => error instanceof Response
    ? error
    : Response.json({ error: "Unexpected error" }, { status: 500 }),
}));
vi.mock("@/lib/analysis/data", () => ({
  getOrCreateSport: mocks.getOrCreateSport,
  findLocalConversationRequest: mocks.findLocalConversationRequest,
  isSportSlug: mocks.isSportSlug,
}));
vi.mock("@/lib/analysis/openai", () => ({
  analysisSettings: () => ({ model: "test-model", effort: "medium" }),
}));
vi.mock("@/lib/entry-confirmation", () => ({
  isEntryConfirmationAcknowledgment: (text: string) =>
    ["들어갔어", "들어갔어요", "진입했어", "진입했어요", "베팅했어", "베팅했어요", "진입 완료", "베팅 완료"].includes(text),
}));
vi.mock("@/lib/rule-instructions", () => ({
  parseRuleInstruction: (text: string) => {
    if (text === "앞으로 유닛은 0.25u로 해줘") return {
      commandKey: "default_recommended_units",
      title: "기본 권장 유닛",
      content: "앞으로 분석의 기본 권장 유닛은 0.25u로 제안한다.",
      acknowledgment: "기본 권장 유닛을 저장했습니다.",
    };
    if (text === "출처는 공식 사이트 우선으로 확인해줘") return {
      commandKey: "preferred_sources",
      title: "출처 확인 우선순위",
      content: "공식 사이트를 우선 출처로 사용한다.",
      acknowledgment: "출처 기준을 저장했습니다.",
    };
    const hypothetical = "혹시 시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록 해. 어차피 우리는 라이브 경기를 바탕으로 판단하는건 아니니까. 그래야 나중에 오답노트도 제대로 작성하지.";
    if (text === hypothetical || text === `알겠어. 그리고 ${hypothetical}`) return {
      commandKey: "pre_game_hypothetical_assessment",
      title: "경기 시작 후 사전 정보 가상 재평가",
      content: "사전 시작 정보를 사용한 가상 평가를 분리한다.",
      acknowledgment: "가상 평가 기준을 저장했습니다.",
    };
    return null;
  },
}));

function request(text: string, idempotencyKey = "request-key-123", action?: string) {
  return new Request("http://localhost/api/sports/mlb/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, idempotencyKey, ...(action ? { action } : {}) }),
  });
}

async function post(sport: string, text: string, idempotencyKey: string, action?: string) {
  return POST(request(text, idempotencyKey, action), { params: Promise.resolve({ sport }) });
}

beforeEach(() => {
  mocks.findLocalConversationRequest.mockReset().mockResolvedValue(null);
  vi.stubEnv("OPENLLMS_BASE_URL", "");
  vi.stubEnv("OPENLLMS_API_KEY", "");
  mocks.requireOwner.mockReset().mockResolvedValue({
    user: { id: "owner-1" },
    supabase: { rpc: mocks.rpc, from: mocks.from },
  });
  mocks.getOrCreateSport.mockReset().mockImplementation(async (_supabase, _owner, slug) => ({
    id: `sport-${slug}`,
    slug,
  }));
  mocks.isSportSlug.mockReset().mockReturnValue(true);
  mocks.rpc.mockReset().mockResolvedValue({
    data: { replayed: false, message: { id: "user-message" }, assistantMessage: { id: "ack" }, rule: { id: "rule" } },
    error: null,
  });
  mocks.from.mockReset();
});

describe("POST /api/sports/[sport]/messages local rules", () => {
  it.each([
    ["mlb", "앞으로 유닛은 0.25u로 해줘", "default_recommended_units"],
    ["soccer", "알겠어. 그리고 혹시 시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록 해. 어차피 우리는 라이브 경기를 바탕으로 판단하는건 아니니까. 그래야 나중에 오답노트도 제대로 작성하지.", "pre_game_hypothetical_assessment"],
    ["tennis", "알겠어. 그리고 혹시 시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록 해. 어차피 우리는 라이브 경기를 바탕으로 판단하는건 아니니까. 그래야 나중에 오답노트도 제대로 작성하지.", "pre_game_hypothetical_assessment"],
    ["wnba", "알겠어. 그리고 혹시 시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록 해. 어차피 우리는 라이브 경기를 바탕으로 판단하는건 아니니까. 그래야 나중에 오답노트도 제대로 작성하지.", "pre_game_hypothetical_assessment"],
    ["mlb", "출처는 공식 사이트 우선으로 확인해줘", "preferred_sources"],
  ])("stores a complete recognized instruction for %s", async (sport, text, commandKey) => {
    const response = await post(sport, text, "rule-key-123");

    expect(response.status).toBe(201);
    expect(mocks.requireOwner).toHaveBeenCalledOnce();
    expect(mocks.getOrCreateSport).toHaveBeenCalledWith(
      expect.anything(), "owner-1", sport,
    );
    expect(mocks.rpc).toHaveBeenCalledWith("apply_rule_instruction", expect.objectContaining({
      p_sport_id: `sport-${sport}`,
      p_request_key: "rule-key-123",
      p_command_key: commandKey,
      p_raw_text: text,
      p_existing_job_id: null,
    }));
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns the stored rows on idempotent replay", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { replayed: true, message: {}, rule: {} }, error: null });

    const response = await post("mlb", "출처는 공식 사이트 우선으로 확인해줘", "rule-key-123");

    expect(response.status).toBe(200);
    expect((await response.json()).replayed).toBe(true);
  });

  it("maps an idempotency collision to 409", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "Idempotency key was already used for a different message" },
    });

    const response = await post("mlb", "출처는 공식 사이트 우선으로 확인해줘", "rule-key-123");

    expect(response.status).toBe(409);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("requires the owner before applying a local instruction", async () => {
    mocks.requireOwner.mockRejectedValueOnce(new Response("Sign in required", { status: 401 }));

    const response = await post("mlb", "출처는 공식 사이트 우선으로 확인해줘", "rule-key-123");

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    "오늘 MLB 경기 분석해줘",
    "앞으로 유닛은 0.25u로 해줘. 오늘 양키스 경기도 봐줘",
    "알겠어. 그리고 출처는 공식 사이트 우선으로 확인해줘?",
  ])("keeps unsupported or mixed messages on the analysis route: %s", async (text) => {
    const response = await post("mlb", text, "analysis-key-123");

    expect(response.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reserves an ordinary game request as an analysis job", async () => {
    vi.stubEnv("OPENLLMS_BASE_URL", "https://gateway.test");
    vi.stubEnv("OPENLLMS_API_KEY", "test-key");
    const text = "오늘 MLB 경기 분석해줘";
    const calls: { table: string; operation: string; values?: unknown }[] = [];
    mocks.from.mockImplementation((table: string) => {
      const call = { table, operation: "", values: undefined as unknown };
      calls.push(call);
      const query: Record<string, (...args: unknown[]) => unknown> = {};
      query.upsert = (...args) => {
        call.operation = "upsert";
        call.values = args[0];
        return query;
      };
      query.insert = (...args) => {
        call.operation = "insert";
        call.values = args[0];
        return query;
      };
      query.update = () => query;
      query.select = () => query;
      query.eq = () => query;
      query.is = () => query;
      query.maybeSingle = async () => ({
        data: table === "analysis_jobs"
          ? { id: "job-1", status: "queued", user_message_id: "message-1" }
          : null,
        error: null,
      });
      query.single = async () => ({
        data: { id: "message-1", content: text },
        error: null,
      });
      return query;
    });

    const response = await post("mlb", text, "analysis-key-123");

    expect(response.status).toBe(202);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(calls[0]).toEqual({
      table: "analysis_jobs",
      operation: "upsert",
      values: expect.objectContaining({ kind: "message", request_key: "analysis-key-123" }),
    });
  });

  it("does not treat an explicit action as a local rule instruction", async () => {
    const response = await post("mlb", "출처는 공식 사이트 우선으로 확인해줘", "analysis-key-123", "check_status");

    expect(response.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("maps a cross-mode request-key collision during analysis job reservation to 409", async () => {
    vi.stubEnv("OPENLLMS_BASE_URL", "https://gateway.test");
    vi.stubEnv("OPENLLMS_API_KEY", "test-key");
    const query: Record<string, (...args: unknown[]) => unknown> = {};
    query.upsert = () => query;
    query.select = () => query;
    query.maybeSingle = async () => ({
      data: null,
      error: { code: "23505", message: "Idempotency key is already used by a rule instruction" },
    });
    mocks.from.mockReturnValue(query);

    const response = await post("mlb", "오늘 MLB 경기 분석해줘", "rule-key-123");

    expect(response.status).toBe(409);
    expect(mocks.from).toHaveBeenCalledWith("analysis_jobs");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("POST natural conversation and historic replay", () => {
 it.each(["들어갔어","들어갔어요","진입했어","진입했어요","베팅했어","베팅했어요","진입 완료","베팅 완료"])("routes new entry reports through the general model: %s",async text => {
  const response=await post("wnba",text,"entry-key-123");
  expect(response.status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.findLocalConversationRequest).toHaveBeenCalledWith(expect.anything(),"owner-1","sport-wnba","entry-key-123");
 });
 it("replays an existing local acknowledgment through its original RPC",async () => {
  mocks.findLocalConversationRequest.mockResolvedValueOnce({request_key:"entry-key-123"});
  mocks.rpc.mockResolvedValueOnce({data:{replayed:true,message:{},assistantMessage:{}},error:null});
  const response=await post("wnba","들어갔어","entry-key-123");
  expect(response.status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith("apply_entry_confirmation_ack",expect.objectContaining({p_raw_text:"들어갔어"}));
 });
 it("preserves stored local request collision checking",async () => {
  mocks.findLocalConversationRequest.mockResolvedValueOnce({request_key:"entry-key-123"});
  mocks.rpc.mockResolvedValueOnce({data:null,error:{code:"23505",message:"different message"}});
  const response=await post("wnba","이번엔 다른 메시지","entry-key-123");
  expect(response.status).toBe(409);
 });
});
