import { requireOwner, apiError } from "@/lib/supabase/server";

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
      !["final", "postponed"].includes(String(body.gameStatus)) ||
      !sourceUrl(body.sourceUrl) ||
      (body.notes != null && typeof body.notes !== "string")
    ) {
      return Response.json(
        {
          error:
            "User confirmation, a final/postponed status, and an HTTPS result source are required",
        },
        { status: 400 },
      );
    }
    const { data, error } = await supabase
      .from("events")
      .update({
        game_status: body.gameStatus,
        result_source_url: body.sourceUrl,
        result_checked_at: new Date().toISOString(),
        ...(body.notes == null ? {} : { notes: body.notes }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return Response.json({ error: "Event not found" }, { status: 404 });
    return Response.json({ event: data });
  } catch (error) {
    return apiError(error);
  }
}
