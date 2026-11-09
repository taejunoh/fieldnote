import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { POST } from "./route";

const auth = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }));
vi.mock("@/lib/supabase/server", () => ({
  requireOwner: async () => ({ supabase: auth.client, user: { id: "owner" } }),
  apiError: (error: unknown) => Response.json({ error: String(error) }, { status: 500 }),
}));

type Bet = {
  id: string;
  owner_id: string;
  stake_units: number | null;
  executed_price: number | null;
  result: string;
  profit_units: number | null;
  [key: string]: unknown;
};

function database(initial: Bet) {
  let bet = { ...initial };
  const writes: Partial<Bet>[] = [];
  auth.client = createClient("https://database.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith("/bets")) return Response.json({ message: "unexpected table" }, { status: 404 });
        if (init?.method === "PATCH") {
          const update = JSON.parse(String(init.body)) as Partial<Bet>;
          writes.push(update);
          if (update.profit_units != null && (bet.stake_units == null || bet.executed_price == null)) {
            return Response.json({ message: "bets_profit_units_check" }, { status: 400 });
          }
          bet = { ...bet, ...update };
          return Response.json(bet);
        }
        return Response.json([bet]);
      },
    },
  });
  return { writes, getBet: () => bet };
}

async function settle(id: string, sourceConfirmed = true, result = "lost") {
  return POST(
    new Request("http://localhost/api/records/bets/test-bet/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        result,
        sourceUrl: "https://scores.example/game",
        ...(sourceConfirmed ? { sourceConfirmed: true } : {}),
      }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("bet result settlement", () => {
  it("requires explicit user confirmation before storing a result", async () => {
    const db = database({
      id: "test-bet",
      owner_id: "owner",
      stake_units: 1,
      executed_price: -110,
      result: "unknown",
      profit_units: null,
    });

    const response = await settle("test-bet", false);

    expect(response.status).toBe(400);
    expect(db.getBet().result).toBe("unknown");
    expect(db.writes).toHaveLength(0);
  });

  it("stores the result without inventing profit when executed price is missing", async () => {
    const db = database({
      id: "test-bet",
      owner_id: "owner",
      stake_units: 1,
      executed_price: null,
      result: "unknown",
      profit_units: null,
    });

    const response = await settle("test-bet");

    expect(response.status).toBe(200);
    expect(db.getBet().result).toBe("lost");
    expect(db.getBet().profit_units).toBeNull();
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]?.profit_units).toBeNull();
  });

  it("repeating the same settlement updates one bet row rather than duplicating it", async () => {
    const db = database({
      id: "test-bet",
      owner_id: "owner",
      stake_units: 1,
      executed_price: null,
      result: "unknown",
      profit_units: null,
    });

    const first = await settle("test-bet");
    const second = await settle("test-bet");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.getBet().id).toBe("test-bet");
    expect(db.getBet().result).toBe("lost");
    expect(db.writes).toHaveLength(2);
  });

  it("calculates profit when both actual stake and executed price are known", async () => {
    const db = database({
      id: "test-bet",
      owner_id: "owner",
      stake_units: 1,
      executed_price: -110,
      result: "unknown",
      profit_units: null,
    });

    const response = await settle("test-bet");

    expect(response.status).toBe(200);
    expect(db.getBet().profit_units).toBe(-1);
  });

  it("stores four-decimal winning profit for fractional stake and plus odds", async () => {
    const db = database({
      id: "test-bet",
      owner_id: "owner",
      stake_units: 0.25,
      executed_price: 117,
      result: "unknown",
      profit_units: null,
    });

    const response = await settle("test-bet", true, "won");

    expect(response.status).toBe(200);
    expect(db.getBet().result).toBe("won");
    expect(db.getBet().profit_units).toBe(0.2925);
    expect(db.writes[0]?.profit_units).toBe(0.2925);
  });
});
