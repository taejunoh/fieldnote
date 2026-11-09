import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { POST } from "./route";

const auth = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }));
vi.mock("@/lib/supabase/server", () => ({
  requireOwner: async () => ({ supabase: auth.client, user: { id: "owner" } }),
  apiError: (error: unknown) => Response.json({ error: String(error) }, { status: 500 }),
}));
vi.mock("@/lib/import/validation", () => ({ isSportSlug: (slug: string) => slug === "mlb" }));

type Row = Record<string, unknown>;
const EVENT_ID = "event-1";
const BET_REQUEST = {
  confirmed: true,
  sportSlug: "mlb",
  eventId: EVENT_ID,
  idempotencyKey: "request-key-123",
  market: "moneyline",
  selection: "Home",
};

function database(options: { eventExists?: boolean } = {}) {
  let bets: Row[] = [];
  let nextBetId = 1;
  let writes = 0;
  const requests: string[] = [];
  auth.client = createClient("https://database.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").at(-1);
        const method = init?.method ?? "GET";
        requests.push(`${method} ${table}`);
        if (table === "sports") return Response.json([{ id: "sport-1" }]);
        if (table === "events") {
          return Response.json(options.eventExists === false ? [] : [{ id: EVENT_ID }]);
        }
        if (table !== "bets") return Response.json({ message: "unexpected table" }, { status: 404 });
        if (method === "POST") {
          writes += 1;
          const body = JSON.parse(String(init?.body)) as Row;
          const key = url.searchParams.get("on_conflict") === "owner_id,request_key"
            ? String(body.request_key)
            : "";
          const existing = bets.find((bet) => bet.owner_id === body.owner_id && bet.request_key === key);
          if (existing && new Headers(init?.headers).get("Prefer")?.includes("resolution=ignore-duplicates")) {
            return Response.json([]);
          }
          const created = {
            stake_units: null,
            executed_price: null,
            result: "unknown",
            profit_units: null,
            ...body,
            id: `bet-${nextBetId++}`,
          };
          bets = [...bets, created];
          return Response.json([created]);
        }
        let rows = bets;
        for (const key of ["owner_id", "request_key"] as const) {
          const filter = url.searchParams.get(key);
          if (filter?.startsWith("eq.")) rows = rows.filter((row) => String(row[key]) === filter.slice(3));
        }
        const accept = new Headers(init?.headers).get("Accept") ?? "";
        return Response.json(accept.includes("application/vnd.pgrst.object+json") ? rows[0] : rows);
      },
    },
  });
  return { getBets: () => bets, getWrites: () => writes, requests };
}

function createBet(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/records/bets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("actual bet entry recording", () => {
  it("requires explicit confirmation before querying or writing records", async () => {
    const db = database();

    const response = await createBet({ ...BET_REQUEST, confirmed: false });

    expect(response.status).toBe(400);
    expect(db.requests).toHaveLength(0);
    expect(db.getBets()).toHaveLength(0);
  });

  it("requires an existing event that resolves from the supplied event id", async () => {
    const db = database({ eventExists: false });

    const response = await createBet(BET_REQUEST);

    expect(response.status).toBe(404);
    expect(db.getBets()).toHaveLength(0);
    expect(db.requests).toContain("GET events");
  });

  it("keeps actual stake and price null when the user has not provided them", async () => {
    database();

    const response = await createBet(BET_REQUEST);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.bet.stake_units).toBeNull();
    expect(payload.bet.executed_price).toBeNull();
  });

  it("uses the idempotency key to return the existing entry without creating a duplicate", async () => {
    const db = database();
    const request = { ...BET_REQUEST, stakeUnits: 1, executedPrice: -110 };

    const first = await createBet(request);
    const second = await createBet(request);
    const secondPayload = await second.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(secondPayload.alreadyRecorded).toBe(true);
    expect(db.getBets()).toHaveLength(1);
    expect(db.getWrites()).toBe(2);
    expect(secondPayload.bet.id).toBe("bet-1");
  });
});
