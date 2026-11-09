import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  rpc: vi.fn(),
  calls: [] as { table: string; filters: [string, ...unknown[]][] }[],
  job: {} as {
    id: string;
    owner_id: string;
    sport_id: string;
    request_key: string;
    kind: string;
    provider: string;
    status: string;
    attempt: number;
    dismissed_attempt: number | null;
    user_message_id: string;
    error: string;
  },
  message: { id: "", content: "" },
}));

vi.mock("@/lib/supabase/server", () => ({
  requireOwner: mocks.requireOwner,
  apiError: (error: unknown) => error instanceof Response
    ? error
    : Response.json({ error: "Unexpected error" }, { status: 500 }),
}));
vi.mock("@/lib/rule-instructions", () => ({
  parseRuleInstruction: (text: string) => text.startsWith("알겠어. 그리고 혹시 시작 시간이 지나서 내가 재평가를 물어보더라도")
    ? {
        commandKey: "pre_game_hypothetical_assessment",
        title: "가상 재평가",
        content: "사전 시작 정보만 사용하는 가상 평가다.",
        acknowledgment: "가상 평가 기준을 저장했습니다.",
      }
    : null,
}));
vi.mock("@/lib/entry-confirmation", () => ({
  isEntryConfirmationAcknowledgment: (text: string) =>
    ["들어갔어", "들어갔어요", "진입했어", "진입했어요", "베팅했어", "베팅했어요", "진입 완료", "베팅 완료"].includes(text),
}));

function from(table: string) {
  const call = { table, filters: [] as [string, ...unknown[]][] };
  mocks.calls.push(call);
  const query: Record<string, (...args: unknown[]) => unknown> = {};
  query.select = () => query;
  query.eq = (...args) => {
    call.filters.push(["eq", ...args]);
    return query;
  };
  query.maybeSingle = async () => ({
    data: table === "analysis_jobs" ? mocks.job : mocks.message,
    error: null,
  });
  return query;
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.job = {
    id: "job-1",
    owner_id: "owner-1",
    sport_id: "sport-1",
    request_key: "request-key-1",
    kind: "message",
    provider: "openllms",
    status: "interrupted",
    attempt: 2,
    dismissed_attempt: null,
    user_message_id: "user-message-1",
    error: "upstream outcome unknown",
  };
  mocks.message = {
    id: "user-message-1",
    content: "알겠어. 그리고 혹시 시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록 해. 어차피 우리는 라이브 경기를 바탕으로 판단하는건 아니니까. 그래야 나중에 오답노트도 제대로 작성하지.",
  };
  mocks.requireOwner.mockReset().mockResolvedValue({
    user: { id: "owner-1" },
    supabase: { from, rpc: mocks.rpc },
  });
  mocks.rpc.mockReset().mockResolvedValue({
    data: { replayed: false, message: { id: "user-message-1" }, assistantMessage: { id: "ack-1" }, rule: { id: "rule-1" }, job: { id: "job-1", status: "interrupted", attempt: 2, dismissed_attempt: 2 } },
    error: null,
  });
});

async function retry() {
  return POST(new Request("http://localhost/api/jobs/job-1/retry", { method: "POST" }), {
    params: Promise.resolve({ id: "job-1" }),
  });
}

describe("POST /api/jobs/[id]/retry local rule resolution", () => {
  it("resolves a failed recognized message locally and preserves the attempt", async () => {
    const response = await retry();

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("apply_rule_instruction", {
      p_sport_id: "sport-1",
      p_request_key: "request-key-1",
      p_command_key: "pre_game_hypothetical_assessment",
      p_raw_text: mocks.message.content,
      p_title: expect.any(String),
      p_content: expect.any(String),
      p_acknowledgment: expect.any(String),
      p_existing_job_id: "job-1",
    });
    expect(mocks.calls[0]?.filters).toContainEqual(["eq", "owner_id", "owner-1"]);
    expect(mocks.calls[1]?.filters).toContainEqual(["eq", "sport_id", "sport-1"]);
  });

  it("keeps unrecognized failed requests on gateway retry", async () => {
    mocks.message.content = "오늘 MLB 경기를 분석해줘";

    const response = await retry();

    expect(response.status).toBe(202);
    expect(mocks.rpc).toHaveBeenCalledWith("retry_gateway_job", { p_job_id: "job-1" });
  });

  it("resolves an entry acknowledgment locally without retrying the analysis job", async () => {
    mocks.job.status = "failed";
    mocks.message.content = "들어갔어";
    const before = { ...mocks.job };
    mocks.rpc.mockResolvedValueOnce({
      data: {
        replayed: false,
        message: { id: "user-message-1" },
        assistantMessage: { id: "entry-ack-1", content: "저장했습니다." },
        acknowledgment: "저장했습니다.",
        job: null,
      },
      error: null,
    });

    const response = await retry();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assistantMessage).toEqual({ id: "entry-ack-1", content: "저장했습니다." });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("apply_entry_confirmation_ack", {
      p_sport_id: "sport-1",
      p_request_key: "request-key-1",
      p_raw_text: "들어갔어",
      p_existing_job_id: "job-1",
    });
    expect(mocks.job).toEqual(before);
  });

  it.each(["interrupted", "waiting_quota", "relogin_required"])(
    "keeps an entry acknowledgment with %s status on the existing retry path",
    async (status) => {
      mocks.job.status = status;
      mocks.message.content = "들어갔어";

      const response = await retry();

      expect(response.status).toBe(202);
      expect(mocks.rpc).toHaveBeenCalledOnce();
      expect(mocks.rpc).toHaveBeenCalledWith("retry_gateway_job", { p_job_id: "job-1" });
    },
  );

  it("keeps active recognized jobs on the existing retry behavior", async () => {
    mocks.job.status = "running";
    mocks.rpc.mockResolvedValueOnce({ error: { message: "Job is not retryable" } });

    const response = await retry();

    expect(response.status).toBe(202);
    expect(mocks.rpc).toHaveBeenCalledWith("retry_gateway_job", { p_job_id: "job-1" });
  });

  it("does not reinterpret completed jobs", async () => {
    mocks.job.status = "completed";

    const response = await retry();

    expect(response.status).toBe(200);
    expect(mocks.calls).toHaveLength(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns the owner guard response without querying jobs", async () => {
    mocks.requireOwner.mockRejectedValueOnce(new Response("Sign in required", { status: 401 }));

    const response = await retry();

    expect(response.status).toBe(401);
    expect(mocks.calls).toHaveLength(0);
  });
});
