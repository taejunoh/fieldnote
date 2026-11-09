import { z } from "zod";
import { resolveConditionalEntry, conditionalEntrySourceSchema } from "../../../../lib/records/conditional-entry";
import { createConditionalEntryServiceClient } from "../../../../lib/supabase/service";
import { requireOwner, apiError } from "@/lib/supabase/server";
import { validateRecordLineage } from "../../../../lib/records/lineage";
import { isSportSlug } from "@/lib/import/validation";

const conditionalSaveSchema=z.object({
  sportSlug:z.string().refine(isSportSlug),
  source:conditionalEntrySourceSchema,
  confirmed:z.literal(true),
  idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  stakeUnits:z.number().finite().positive().max(99999.999).refine(value=>Number(value.toFixed(3))===value).nullable().optional(),
  executedPrice:z.number().int().min(-2147483648).max(2147483647).refine(value=>Math.abs(value)>=100).nullable().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireOwner();
    const body = (await request.json()) as Record<string, unknown>;
    if ("source" in body) {
      const parsed=conditionalSaveSchema.safeParse(body);
      if(!parsed.success) return Response.json({error:"Invalid conditional entry request"},{status:400});
      const conditional=parsed.data;
      const stake=conditional.stakeUnits,price=conditional.executedPrice;
      const {data:sport,error:sportError}=await supabase.from("sports").select("id").eq("owner_id",user.id).eq("slug",conditional.sportSlug).maybeSingle();
      if(sportError) throw sportError;
      if(!sport) return Response.json({error:"Sport not found"},{status:404});
      const snapshot=await resolveConditionalEntry(supabase,user.id,sport.id,conditional.sportSlug,conditional.source);
      const {data,error}=await createConditionalEntryServiceClient().rpc("record_conditional_entry",{p_owner_id:user.id,p_sport_id:sport.id,p_request_key:conditional.idempotencyKey,p_confirmed:true,p_source_candidate:snapshot,p_stake_units:stake??null,p_executed_price:price??null});
      if(error) {const status=error.code==="23505"?409:error.code==="22023"?400:error.code==="P0002"?404:500;return Response.json({error:status===500?"Conditional entry could not be recorded":error.message},{status});}
      return Response.json(data,{status:data?.alreadyRecorded?200:201});
    }
    if (
      body.confirmed !== true ||
      !isSportSlug(body.sportSlug) ||
      typeof body.eventId !== "string" ||
      typeof body.idempotencyKey !== "string" ||
      body.idempotencyKey.length < 8 ||
      body.idempotencyKey.length > 100 ||
      typeof body.market !== "string" ||
      !body.market.trim() ||
      typeof body.selection !== "string" ||
      !body.selection.trim() ||
      (body.stakeUnits != null &&
        (typeof body.stakeUnits !== "number" || !Number.isFinite(body.stakeUnits) || body.stakeUnits <= 0)) ||
      (body.executedPrice != null &&
        (!Number.isInteger(body.executedPrice) ||
          Math.abs(body.executedPrice as number) < 100))
    ) {
      return Response.json(
        {
          error:
            "Explicit confirmation, an unambiguous event, market, and selection are required",
        },
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
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("owner_id", user.id)
      .eq("sport_id", sport.id)
      .eq("id", body.eventId)
      .maybeSingle();
    if (eventError) throw eventError;
    if (!event)
      return Response.json(
        { error: "Event not found or ambiguous" },
        { status: 404 },
      );
    const lineage = await validateRecordLineage(supabase,user.id,sport.id,{...body,eventId:event.id});
    const { data, error } = await supabase
      .from("bets")
      .upsert(
        {
          owner_id: user.id,
          sport_id: sport.id,
          event_id: event.id,
          source_message_id: lineage.source_message_id,
          source_recommendation_id: lineage.source_recommendation_id,
          market: body.market.trim(),
          selection: body.selection.trim(),
          request_key: body.idempotencyKey,
          stake_units: body.stakeUnits ?? null,
          executed_price: body.executedPrice ?? null,
          entry_confirmed_at: new Date().toISOString(),
          result: "unknown",
          profit_units: null,
        },
        { onConflict: "owner_id,request_key", ignoreDuplicates: true },
      )
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (data) return Response.json({ bet: data }, { status: 201 });
    const { data: existing, error: existingError } = await supabase
      .from("bets")
      .select("*")
      .eq("owner_id", user.id)
      .eq("request_key", body.idempotencyKey)
      .single();
    if (existingError) throw existingError;
    if (
      existing.event_id !== event.id ||
      (existing.source_message_id ?? null) !== lineage.source_message_id ||
      (existing.source_recommendation_id ?? null) !== lineage.source_recommendation_id ||
      existing.market !== body.market.trim() ||
      existing.selection !== body.selection.trim() ||
      Number(existing.stake_units ?? 0) !== Number(body.stakeUnits ?? 0) ||
      existing.executed_price !== (body.executedPrice ?? null)
    ) {
      return Response.json(
        { error: "Idempotency key was used for a different bet" },
        { status: 409 },
      );
    }
    return Response.json({ bet: existing, alreadyRecorded: true });
  } catch (error) {
    return apiError(error);
  }
}
