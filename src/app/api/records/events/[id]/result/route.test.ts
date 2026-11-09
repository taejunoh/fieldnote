import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { POST } from "./route";

const auth = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }));
vi.mock("@/lib/supabase/server", () => ({
  requireOwner: async () => ({ supabase: auth.client, user: { id: "owner" } }),
  apiError: (error: unknown) => Response.json({ error: String(error) }, { status: 500 }),
}));

function database() {
  const updates: Record<string, unknown>[] = [];
  const event: Record<string, unknown> = { id: "event-1", owner_id: "owner", game_status: "scheduled" };
  auth.client = createClient("https://database.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith("/events") || init?.method !== "PATCH") {
          return Response.json({ message: "unexpected request" }, { status: 404 });
        }
        const update = JSON.parse(String(init.body)) as Record<string, unknown>;
        updates.push(update);
        Object.assign(event, update);
        return Response.json(event);
      },
    },
  });
  return { event, updates };
}

function recordResult(sourceConfirmed: boolean) {
  return POST(
    new Request("http://localhost/api/records/events/event-1/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gameStatus: "final",
        sourceUrl: "https://scores.example/game",
        sourceConfirmed,
      }),
    }),
    { params: Promise.resolve({ id: "event-1" }) },
  );
}

describe("event result recording", () => {
  it("rejects a result until the user confirms they checked the linked source", async () => {
    const db = database();

    const response = await recordResult(false);

    expect(response.status).toBe(400);
    expect(db.updates).toHaveLength(0);
    expect(db.event.game_status).toBe("scheduled");
  });

  it("records the result and linked source after explicit user confirmation", async () => {
    const db = database();

    const response = await recordResult(true);

    expect(response.status).toBe(200);
    expect(db.event.game_status).toBe("final");
    expect(db.event.result_source_url).toBe("https://scores.example/game");
    expect(db.updates).toHaveLength(1);
  });
});
