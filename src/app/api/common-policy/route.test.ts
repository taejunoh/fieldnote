import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
const db = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), rpc: vi.fn(), filters: [] as unknown[] }));
vi.mock("@/lib/supabase/server", () => ({ requireOwner: db.auth }));
vi.mock("@/lib/common-policy", async () => await import("../../../lib/common-policy"));
const version = { id: "00000000-0000-4000-8000-000000000001", owner_id: "owner", title: "Policy", version_date: "2026-10-06", content: " \n한글\r\n ", content_hash: "a".repeat(64), status: "adopted", supersedes_id: null, created_at: "2026-10-06T00:00:00Z" };
const body = { title: version.title, versionDate: version.version_date, content: version.content, expectedVersionId: null };
function request(value: unknown = body) { return new Request("http://localhost/api/common-policy", { method: "POST", body: JSON.stringify(value) }); }
beforeEach(() => {
  db.filters.length = 0; db.rpc.mockReset(); db.auth.mockReset();
  db.read.mockResolvedValue({ data: [version], error: null });
  db.rpc.mockResolvedValue({ data: version, error: null });
  const query = { select: () => query, eq: (...args: unknown[]) => { db.filters.push(args); return query; }, order: db.read };
  db.auth.mockResolvedValue({ user: { id: "owner" }, supabase: { from: () => query, rpc: db.rpc } });
});
describe("owner common policy API", () => {
  it("returns current revision and complete owner history", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ current: version, history: [version] });
    expect(db.filters).toContainEqual(["owner_id", "owner"]);
  });
  it("returns an explicit missing policy", async () => {
    db.read.mockResolvedValue({ data: [], error: null });
    expect(await (await GET()).json()).toEqual({ current: null, history: [] });
  });
  it("adopts exact text via authenticated RPC without an owner parameter", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ current: version, history: [version] });
    expect(db.rpc).toHaveBeenCalledWith("adopt_common_policy", { p_title: body.title, p_version_date: body.versionDate, p_content: body.content, p_expected_version_id: null });
  });
  it("rejects omitted expected head before writing", async () => {
    expect((await POST(request({ title: "Policy", versionDate: "2026-10-06", content: "New" }))).status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("maps stale editors to conflict with no database content leak", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "PRIVATE CONTENT" } });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });
  it("keeps database failures generic", async () => {
    db.read.mockResolvedValue({ data: null, error: { message: "PRIVATE CONTENT" } });
    const response = await GET();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });
  it.each([401, 403])("enforces owner authentication for both methods (%s)", async (status) => {
    db.auth.mockRejectedValue(new Response("Access denied", { status }));
    expect((await GET()).status).toBe(status);
    expect((await POST(request())).status).toBe(status);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
