import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const database = vi.hoisted(() => ({
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  requireOwner: async () => ({
    user: { id: "owner" },
    supabase: {
      from: () => ({
        upsert: () => ({
          select: () => ({ single: async () => ({ data: { id: "sport" }, error: null }) }),
        }),
      }),
      rpc: database.rpc,
    },
  }),
  apiError: (error: unknown) => Response.json({ error: String(error) }, { status: 500 }),
}));
vi.mock("@/lib/import/validation", () => ({
  isSportSlug: (value: unknown) => value === "mlb",
}));

const sourceMessageId = "00000000-0000-4000-8000-000000000094";
const supersedesId = "00000000-0000-4000-8000-000000000097";
function request(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/rules", {
    method: "POST",
    body: JSON.stringify({
      sportSlug: "mlb",
      title: "Corrected",
      content: "New rule",
      status: "adopted",
      supersedesId,
      sourceMessageId,
      ...overrides,
    }),
  });
}

beforeEach(() => database.rpc.mockReset());

describe("rule corrections", () => {
  it("passes the correction source and predecessor to the atomic RPC", async () => {
    database.rpc.mockReturnValue({
      single: async () => ({ data: { id: "new-rule" }, error: null }),
    });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(database.rpc).toHaveBeenCalledWith("create_criteria_version", {
      p_sport_id: "sport",
      p_title: "Corrected",
      p_content: "New rule",
      p_status: "adopted",
      p_supersedes_id: supersedesId,
      p_source_message_id: sourceMessageId,
    });
  });

  it("rejects malformed source IDs before writing", async () => {
    const response = await POST(request({ sourceMessageId: "wrong" }));
    expect(response.status).toBe(400);
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "P0002", message: "Previous rule not found" }, 404],
    [{ code: "P0001", message: "Previous rule is not adopted" }, 409],
    [{ code: "P0002", message: "Source user message not found" }, 404],
  ])("maps rejected correction %j to HTTP %i", async (error, status) => {
    database.rpc.mockReturnValue({ single: async () => ({ data: null, error }) });
    const response = await POST(request());
    expect(response.status).toBe(status);
  });
});
