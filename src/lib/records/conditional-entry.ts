import type { SupabaseClient } from "@supabase/supabase-js";
import { attestAnalysisSource } from "../analysis/source-attestation";
import { z } from "zod";
import { verifiedEntryCandidates } from "../analysis/actionable-bets";
import { loadPrivateDisplayCandidates } from "../analysis/private-display-candidates";
import type { CandidateOverlay } from "../analysis/display-candidates";
import type { ConditionalEntryCandidate, StoredConditionalEntrySource } from "./entry-types";

const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const conditionalEntrySourceSchema=z.object({kind:z.literal("conditional_candidate"),sourceKind:z.enum(["original_block","reviewed_overlay"]),jobId:z.string().uuid(),messageId:z.string().uuid(),itemKey:z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),rawSha256:hash,candidateSha256:hash}).strict();
type Row=Record<string,unknown>;
/** Cheap discovery only; this never authorizes an entry or replaces the full verifier. */
export function mayHaveConditionalEntrySource(ownerId:string,sportId:string,sport:string,message:Row,overlays:CandidateOverlay[]):boolean {
 if(message.role!=="assistant" || message.owner_id!==ownerId || message.sport_id!==sportId || typeof message.analysis_job_id!=="string") return false;
 const metadata=message.metadata as Row|undefined;
 return typeof metadata?.original_model_response==="string" && (/^```analysis-candidates[^\S\r\n]*$/m.test(metadata.original_model_response) || overlays.some(row=>row.owner_id===ownerId && row.sport===sport && row.job_id===message.analysis_job_id && row.message_id===message.id));
}
export function entryCandidatesForMessage(ownerId:string,sportId:string,sport:string,message:Row,job:Row|undefined,overlays:CandidateOverlay[],now=new Date(),attempt?:Row):StoredConditionalEntrySource[] {
 if(!attestAnalysisSource(ownerId,sportId,sport,message,job,attempt)) return [];
 return verifiedEntryCandidates({sport,ownerId,jobId:String(job!.id),kind:String(job!.kind),message,candidateOverlays:overlays,now});
}
export function publicEntryCandidate(snapshot:StoredConditionalEntrySource):ConditionalEntryCandidate {
 const {version,provenance,createdAt,sourceUrl,statusAtAssessment,...candidate}=snapshot;
 void version;void provenance;void createdAt;void sourceUrl;void statusAtAssessment;
 return candidate;
}
export async function resolveConditionalEntry(supabase:SupabaseClient,ownerId:string,sportId:string,sport:string,source:unknown):Promise<StoredConditionalEntrySource> {
 const parsed=conditionalEntrySourceSchema.safeParse(source);
 if(!parsed.success) throw new Response("Invalid conditional source",{status:400});
 const ref=parsed.data;
 const [messageResult,jobResult,overlays]=await Promise.all([
   supabase.from("messages").select("*").eq("owner_id",ownerId).eq("sport_id",sportId).eq("id",ref.messageId).maybeSingle(),
   supabase.from("analysis_jobs").select("*").eq("owner_id",ownerId).eq("sport_id",sportId).eq("id",ref.jobId).maybeSingle(),
   loadPrivateDisplayCandidates(),
 ]);
 if(messageResult.error) throw messageResult.error;if(jobResult.error) throw jobResult.error;
 const job=jobResult.data;
 const attemptResult=job?.current_attempt_id ? await supabase.from("analysis_attempts").select("id,owner_id,job_id,status,provider_metadata,input_snapshot").eq("owner_id",ownerId).eq("job_id",job.id).eq("id",job.current_attempt_id).maybeSingle() : {data:null,error:null};
 if(attemptResult.error) throw attemptResult.error;
 const candidates=messageResult.data?entryCandidatesForMessage(ownerId,sportId,sport,messageResult.data,job||undefined,overlays,new Date(),attemptResult.data||undefined):[];
 const matches=candidates.filter(row=>Object.entries(ref).every(([key,value])=>row.source[key as keyof typeof ref]===value));
 if(matches.length!==1) throw new Response("Conditional source unavailable or ambiguous",{status:404});
 return matches[0];
}
