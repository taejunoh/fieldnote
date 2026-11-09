import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {requireOwner,apiError} from "@/lib/supabase/server";
import {isSportSlug} from "@/lib/import/validation";
import {freezeRecommendation,evaluateRecommendation} from "../../../../lib/records/recommendation-evaluation";
const https=z.string().url().refine(v=>v.startsWith("https://"));
const timestamp=z.string().datetime({offset:true}).refine(v=>Date.parse(v)<=Date.now(),"Future evidence times are not allowed");
const schema=z.object({sportSlug:z.string(),recommendationId:z.string().min(1),idempotencyKey:z.string().min(8).max(100),reviewed:z.literal(true),supersedesEvaluationId:z.string().min(1).optional(),observedPrice:z.number().int().refine(n=>Math.abs(n)>=100).nullable().optional(),quoteSourceUrl:https.nullable().optional(),quoteObservedAt:timestamp.nullable().optional(),settlementContract:z.object({market:z.string(),selection:z.string(),marketType:z.enum(["moneyline","spread","total"]),direction:z.enum(["over","under"]).optional(),period:z.literal("full_game"),overtimeIncluded:z.boolean(),line:z.number().finite().nullable().optional()}).strict().nullable().optional(),outcome:z.enum(["won","lost","push","void"]),outcomeSourceUrl:https,outcomeCheckedAt:timestamp}).strict();
export async function POST(request:Request) {
 try {
  const parsed=schema.safeParse(await request.json());
  if(!parsed.success||!isSportSlug(parsed.data.sportSlug))return Response.json({error:"Review confirmation, explicit quote/contract when available, and a sourced outcome are required"},{status:400});
  const body=parsed.data;
  const {supabase,user}=await requireOwner();
  const sportResult=await supabase.from("sports").select("id").eq("owner_id",user.id).eq("slug",body.sportSlug).maybeSingle();
  if(sportResult.error)throw sportResult.error;
  if(!sportResult.data)return Response.json({error:"Sport not found"},{status:404});
  const sportId=sportResult.data.id;
  const recResult=await supabase.from("recommendations").select("*").eq("owner_id",user.id).eq("sport_id",sportId).eq("id",body.recommendationId).maybeSingle();
  if(recResult.error)throw recResult.error;
  const rec=recResult.data;
  if(!rec)return Response.json({error:"Recommendation not found"},{status:404});
  let frozen;
  if(body.supersedesEvaluationId){
   const prior=await supabase.from("recommendation_evaluations").select("*").eq("owner_id",user.id).eq("sport_id",sportId).eq("recommendation_id",rec.id).eq("id",body.supersedesEvaluationId).maybeSingle();
   if(prior.error)throw prior.error;
   if(!prior.data)return Response.json({error:"Evaluation predecessor unavailable for this recommendation"},{status:409});
   frozen=prior.data.frozen_recommendation;
  }else{
   if(!rec.source_message_id)return Response.json({error:"Original source snapshot unavailable; this recommendation remains unscored"},{status:422});
   const messageResult=await supabase.from("messages").select("*").eq("owner_id",user.id).eq("sport_id",sportId).eq("id",rec.source_message_id).maybeSingle();
   if(messageResult.error)throw messageResult.error;
   if(!messageResult.data)return Response.json({error:"Original source message unavailable"},{status:422});
   try{frozen=freezeRecommendation(rec,messageResult.data);}catch{return Response.json({error:"Original recommendation snapshot missing or changed; scoring refused"},{status:422});}
  }
  const evaluationInput={observedPrice:body.observedPrice??null,quoteSourceUrl:body.quoteSourceUrl??null,quoteObservedAt:body.quoteObservedAt??null,settlementContract:body.settlementContract??null,outcome:body.outcome,outcomeSourceUrl:body.outcomeSourceUrl,outcomeCheckedAt:body.outcomeCheckedAt};
  const row={owner_id:user.id,sport_id:sportId,recommendation_id:rec.id,source_message_id:frozen.source_message_id,supersedes_evaluation_id:body.supersedesEvaluationId??null,request_key:body.idempotencyKey,frozen_recommendation:frozen,evaluation_input:evaluationInput};
  const result=await supabase.from("recommendation_evaluations").upsert(row,{onConflict:"owner_id,request_key",ignoreDuplicates:true}).select("*").maybeSingle();
  if(result.error){if(result.error.code==="23505")return Response.json({error:"Evaluation already exists or predecessor was superseded; reload the latest version"},{status:409});throw result.error;}
  let evaluation=result.data;
  if(!evaluation){
   const prior=await supabase.from("recommendation_evaluations").select("*").eq("owner_id",user.id).eq("request_key",body.idempotencyKey).single();
   if(prior.error)throw prior.error;
   if(prior.data.recommendation_id!==rec.id||(prior.data.supersedes_evaluation_id??null)!==(body.supersedesEvaluationId??null)||!isDeepStrictEqual(prior.data.evaluation_input,evaluationInput))return Response.json({error:"Idempotency key used for a different evaluation"},{status:409});
   evaluation=prior.data;
  }
  return Response.json({recommendationEvaluation:{...evaluation,evaluation:evaluateRecommendation(evaluation.frozen_recommendation,evaluation.evaluation_input,evaluation.created_at)},alreadyRecorded:!result.data},{status:result.data?201:200});
 }catch(error){return apiError(error);}
}
