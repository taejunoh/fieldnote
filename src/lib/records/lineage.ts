import type { SupabaseClient } from "@supabase/supabase-js";
export interface RecordLineageInput {
  eventId?: unknown;
  sourceMessageId?: unknown;
  sourceRecommendationId?: unknown;
  sourceBetId?: unknown;
}
function invalid(message:string):never {throw Response.json({error:message},{status:400});}
export async function validateRecordLineage(db:SupabaseClient,ownerId:string,sportId:string,input:RecordLineageInput) {
  if(input.eventId!=null&&(typeof input.eventId!=="string"||!input.eventId.trim())) invalid("Invalid event ID");
  let eventId = typeof input.eventId === "string" && input.eventId ? input.eventId : null;
  const lineage:Record<string,string|null>={event_id:eventId,source_message_id:null,source_recommendation_id:null,source_bet_id:null};
  for (const [key,table,column] of [["sourceMessageId","messages","source_message_id"],["sourceRecommendationId","recommendations","source_recommendation_id"],["sourceBetId","bets","source_bet_id"]] as const) {
    const id=input[key];
    if(id==null) continue;
    if(typeof id!=="string" || !id.trim()) invalid("Invalid source record ID");
    const {data,error}=await db.from(table).select("*").eq("owner_id",ownerId).eq("sport_id",sportId).eq("id",id).maybeSingle();
    if(error) throw error;
    if(!data) invalid("Source record is unavailable for this sport");
    if(table!=="messages" && data.event_id) {
      if(eventId && eventId!==data.event_id) invalid("Source records refer to different events");
      eventId=data.event_id;
    }
    lineage[column]=id;
  }
  if(eventId){
    const {data,error}=await db.from("events").select("id").eq("owner_id",ownerId).eq("sport_id",sportId).eq("id",eventId).maybeSingle();
    if(error) throw error;
    if(!data) invalid("Event is unavailable for this sport");
  }
  lineage.event_id=eventId;
  return lineage;
}
