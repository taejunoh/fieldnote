import { requireOwner, apiError } from "@/lib/supabase/server";
import { validateRecordLineage } from "../../../../lib/records/lineage";
import { isSportSlug } from "@/lib/import/validation";

function sourceUrl(value: unknown): value is string {
  try {
    return typeof value === "string" && new URL(value).protocol === "https:";
  } catch {
    return false;
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
      typeof body.lesson !== "string" ||
      !body.lesson.trim() ||
      typeof body.idempotencyKey !== "string" ||
      body.idempotencyKey.length < 8 ||
      body.idempotencyKey.length > 100 ||
      (body.decisionAtTime != null &&
        typeof body.decisionAtTime !== "string") ||
      (body.outcome != null && typeof body.outcome !== "string") ||
      (body.outcome && !sourceUrl(body.outcomeSourceUrl)) ||
      (body.outcomeSourceUrl != null && !sourceUrl(body.outcomeSourceUrl))
    ) {
      return Response.json(
        { error: "Sport, title, and lesson are required" },
        { status: 400 },
      );
    }
    const { data: sport, error: sportError } = await supabase
      .from("sports")
      .select("id")
      .eq("owner_id", user.id)
      .eq("slug", body.sportSlug)
      .maybeSingle();
    if (sportError) throw sportError;
    if (!sport)
      return Response.json({ error: "Sport not found" }, { status: 404 });
    const lineage = await validateRecordLineage(supabase,user.id,sport.id,body);
    if (lineage.event_id) {
      const { data: event, error } = await supabase
        .from("events")
        .select("id")
        .eq("id", lineage.event_id)
        .eq("sport_id", sport.id)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (!event)
        return Response.json({ error: "Event not found" }, { status: 404 });
    }
    const { data, error } = await supabase
      .from("mistake_notes")
      .upsert(
        {
          owner_id: user.id,
          sport_id: sport.id,
          ...lineage,
          request_key: body.idempotencyKey,
          title: body.title.trim(),
          decision_at_time: body.decisionAtTime || null,
          outcome: body.outcome || null,
          lesson: body.lesson.trim(),
          outcome_source_url:
            typeof body.outcomeSourceUrl === "string"
              ? body.outcomeSourceUrl
              : null,
        },
        { onConflict: "owner_id,request_key", ignoreDuplicates: true },
      )
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (data) return Response.json({ mistakeNote: data }, { status: 201 });
    const { data: existing, error: existingError } = await supabase
      .from("mistake_notes")
      .select("*")
      .eq("owner_id", user.id)
      .eq("request_key", body.idempotencyKey)
      .single();
    if (existingError) throw existingError;
    if (
      existing.sport_id !== sport.id ||
      existing.event_id !== lineage.event_id ||
      (existing.source_message_id ?? null) !== lineage.source_message_id ||
      (existing.source_recommendation_id ?? null) !== lineage.source_recommendation_id ||
      (existing.source_bet_id ?? null) !== lineage.source_bet_id ||
      existing.title !== body.title.trim() ||
      existing.lesson !== body.lesson.trim() ||
      existing.decision_at_time !== (body.decisionAtTime || null) ||
      existing.outcome !== (body.outcome || null) ||
      existing.outcome_source_url !== (body.outcomeSourceUrl || null)
    ) {
      return Response.json(
        { error: "Idempotency key was used for a different note" },
        { status: 409 },
      );
    }
    return Response.json({ mistakeNote: existing, alreadyRecorded: true });
  } catch (error) {
    return apiError(error);
  }
}
