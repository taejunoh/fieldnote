import { resolveConditionalEntry, publicEntryCandidate } from "../../../../lib/records/conditional-entry";
import { requireOwner,apiError } from "@/lib/supabase/server";
import { isSportSlug } from "@/lib/import/validation";
import { validateRecordLineage } from "../../../../lib/records/lineage";

/** Preparation only: neither a report, a recommendation nor a quote writes a bet. */
export async function POST(request:Request) {
  try {
    const body=await request.json();
    if(!isSportSlug(body.sportSlug)||(!("source" in body)&&typeof body.sourceMessageId!=="string")) return Response.json({error:"Sport and original message are required"},{status:400});
    const {supabase,user}=await requireOwner();
    const {data:sport,error}=await supabase.from("sports").select("id").eq("owner_id",user.id).eq("slug",body.sportSlug).maybeSingle();
    if(error) throw error;
    if(!sport) return Response.json({error:"Sport not found"},{status:404});
    if("source" in body) {
      if(Object.keys(body).some(key=>!["sportSlug","source"].includes(key))) return Response.json({error:"Mixed conditional source fields"},{status:400});
      const snapshot=await resolveConditionalEntry(supabase,user.id,sport.id,body.sportSlug,body.source);
      const {data:event,error:eventError}=await supabase.from("events").select("id").eq("owner_id",user.id).eq("sport_id",sport.id).eq("event_key",snapshot.eventKey).maybeSingle();
      if(eventError) throw eventError;
      const candidate=publicEntryCandidate(snapshot);
      return Response.json({requiresConfirmation:true,prefill:{mode:"conditional",source:candidate.source,candidate,eventId:event?.id??null,market:candidate.market,selection:candidate.selection,sourceMessageId:candidate.source.messageId,sourceRecommendationId:null,stakeUnits:null,executedPrice:null},missing:[],notice:"Confirm the actual target and entry. A missing event is registered only when you save."});
    }
    const lineage=await validateRecordLineage(supabase,user.id,sport.id,body);
    let recommendation:Record<string,unknown>|null=null;
    if(lineage.source_recommendation_id) {
      const result=await supabase.from("recommendations").select("*").eq("owner_id",user.id).eq("sport_id",sport.id).eq("id",lineage.source_recommendation_id).maybeSingle();
      if(result.error) throw result.error;
      recommendation=result.data;
    }
    return Response.json({requiresConfirmation:true,prefill:{eventId:lineage.event_id,market:recommendation?.market||"",selection:recommendation?.selection||"",sourceMessageId:lineage.source_message_id,sourceRecommendationId:lineage.source_recommendation_id,stakeUnits:null,executedPrice:null},missing:[...(!lineage.event_id?["eventId"]:[]),...(!recommendation?["market","selection"]:[])],notice:"Review the event, market and selection and explicitly confirm actual entry. Recommended units and quoted prices are not actual fills."});
  }catch(error){return apiError(error);}
}
