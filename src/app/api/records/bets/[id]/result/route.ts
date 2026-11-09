import { requireOwner, apiError } from "@/lib/supabase/server";
import { calculateBetProfit } from "../../../../../../lib/records/settlement";

function sourceUrl(value: unknown): value is string {
  try {
    return typeof value === "string" && new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user } = await requireOwner();
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    if (
      body.sourceConfirmed !== true ||
      !["won", "lost", "push", "void"].includes(String(body.result)) ||
      !sourceUrl(body.sourceUrl)
    ) {
      return Response.json(
        {
          error:
            "User confirmation, a settled result, and an HTTPS source are required",
        },
        { status: 400 },
      );
    }
    const { data: bet, error: readError } = await supabase
      .from("bets")
      .select("*")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (readError) throw readError;
    if (!bet) return Response.json({ error: "Bet not found" }, { status: 404 });
    const stake = bet.stake_units == null ? null : Number(bet.stake_units);
    const price =
      bet.executed_price == null ? null : Number(bet.executed_price);
    // Preserve the reported game outcome while leaving profit unknown until
    // actual entry details are available for settlement.
    const profit = calculateBetProfit(String(body.result), stake, price);
    const { data, error } = await supabase
      .from("bets")
      .update({
        result: body.result,
        result_source_url: body.sourceUrl,
        result_checked_at: new Date().toISOString(),
        profit_units: profit,
      })
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("*")
      .single();
    if (error) throw error;
    return Response.json({ bet: data });
  } catch (error) {
    return apiError(error);
  }
}
