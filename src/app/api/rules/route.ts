import { requireOwner, apiError } from "@/lib/supabase/server";
import { isSportSlug } from "@/lib/import/validation";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireOwner();
    const slug = new URL(request.url).searchParams.get("sport");
    if (!isSportSlug(slug))
      return Response.json({ error: "Invalid sport" }, { status: 400 });
    const { data: sport, error: sportError } = await supabase
      .from("sports")
      .select("id")
      .eq("owner_id", user.id)
      .eq("slug", slug)
      .maybeSingle();
    if (sportError) throw sportError;
    if (!sport) return Response.json({ rules: [] });
    const { data, error } = await supabase
      .from("criteria_versions")
      .select("*")
      .eq("sport_id", sport.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return Response.json({ rules: data });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireOwner();
    const body = (await request.json()) as Record<string, unknown>;
    if (
      !isSportSlug(body.sportSlug) ||
      typeof body.title !== "string" ||
      !body.title.trim() ||
      typeof body.content !== "string" ||
      !body.content.trim() ||
      !["adopted", "proposed"].includes(String(body.status)) ||
      (body.supersedesId != null &&
        (typeof body.supersedesId !== "string" || !uuidPattern.test(body.supersedesId))) ||
      (body.sourceMessageId != null &&
        (typeof body.sourceMessageId !== "string" || !uuidPattern.test(body.sourceMessageId)))
    )
      return Response.json({ error: "Invalid rule" }, { status: 400 });
    const { data: sport, error: sportError } = await supabase
      .from("sports")
      .upsert(
        { owner_id: user.id, slug: body.sportSlug },
        { onConflict: "owner_id,slug" },
      )
      .select("id")
      .single();
    if (sportError) throw sportError;
    const { data, error } = await supabase
      .rpc("create_criteria_version", {
        p_sport_id: sport.id,
        p_title: body.title.trim(),
        p_content: body.content.trim(),
        p_status: body.status,
        p_supersedes_id: body.supersedesId || null,
        p_source_message_id: body.sourceMessageId || null,
      })
      .single();
    if (error) {
      if (error.code === "P0002")
        return Response.json({ error: error.message }, { status: 404 });
      if (error.code === "P0001")
        return Response.json({ error: error.message }, { status: 409 });
      throw error;
    }
    return Response.json({ rule: data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
