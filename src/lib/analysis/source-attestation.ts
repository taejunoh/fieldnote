import { isDeepStrictEqual } from "node:util";
type Row=Record<string,unknown>;
/** Shared immutable-source fence; identical to the conditional entry source verifier. */
export function attestAnalysisSource(ownerId:string,sportId:string,sport:string,message:Row,job:Row|undefined,attempt:Row|undefined):boolean {
 if(!job || message.role!=="assistant" || message.owner_id!==ownerId || message.sport_id!==sportId || job.owner_id!==ownerId || job.sport_id!==sportId || job.status!=="completed" || job.result_type!=="analysis" || job.result_message_id!==message.id || message.analysis_job_id!==job.id || typeof job.id!=="string") return false;
 const metadata=message.metadata as Row|undefined, original=job.provider_metadata as Row|undefined;
 if(!metadata || !original || metadata.type!=="analysis" || original.type!=="analysis" || metadata.result_type==="conversation" || original.result_type==="conversation" || typeof metadata.original_model_response!=="string" || original.original_model_response!==metadata.original_model_response || original.checked_at!==metadata.checked_at || !isDeepStrictEqual(original.sources,metadata.sources) || !isDeepStrictEqual(original.common_policy??null,metadata.common_policy??null)) return false;
 if(!attempt || attempt.id!==job.current_attempt_id || attempt.owner_id!==ownerId || attempt.job_id!==job.id || attempt.status!=="completed") return false;
 const trusted=attempt.provider_metadata as Row|undefined,input=attempt.input_snapshot as Row|undefined;
 if(!trusted || !input || trusted.type!=="analysis" || trusted.verified!==true || trusted.searched!==true || trusted.terminalStatus!=="completed" || trusted.result_type==="conversation" || input.attempt_id!==attempt.id || typeof input.context!=="string") return false;
 const originalInput=metadata.input_snapshot as Row|undefined;
 if(!originalInput || ["attempt_id","context_sha256","instructions_sha256","common_policy"].some(key=>!isDeepStrictEqual(originalInput[key]??null,input[key]??null))) return false;
 let context:Row;
 try { context=JSON.parse(input.context); }catch{return false;}
 if(!context || typeof context!=="object" || Array.isArray(context) || context.sport!==sport || context.current_job_kind!==job.kind || !isDeepStrictEqual(input.common_policy??null,metadata.common_policy??null)) return false;
 const fields=["type","result_type","verified","searched","terminalStatus","original_model_response","checked_at","sources","common_policy","hypothetical","analysis_purpose","purpose","response_purpose_status","response_purpose","delivery"];
 if(fields.some(key=>!isDeepStrictEqual(original[key]??null,metadata[key]??null) || !isDeepStrictEqual(trusted[key]??null,metadata[key]??null))) return false;
 return true;
}
