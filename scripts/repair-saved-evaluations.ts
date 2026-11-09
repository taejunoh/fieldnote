/** Saved evidence only. Dry-run default; apply accepts only an exact reviewed manifest SHA.
 * --plan private-plan.json --output private-manifest.json [--dry-run]
 * --manifest private-manifest.json --apply --manifest-sha256 <reviewed SHA>
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required; never calls a provider.
 */
import { readFile, writeFile, realpath } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { deriveSavedEvaluationRepair, verifyReviewedSavedEvaluationRepair, sha256, type SavedEvaluationInput } from "../src/lib/analysis/evaluation-repair";
const args=process.argv.slice(2);
function option(name:string) { const i=args.indexOf(name); if(i<0)return undefined; if(!args[i+1]||args[i+1].startsWith("--"))throw new Error(`Missing ${name}`); return args[i+1]; }
const safeSqlState = (value: unknown) => typeof value === "string" && /^[0-9A-Z]{5}$/.test(value) ? value : undefined;
export class SafeRepairCliError extends Error {
 readonly stage = "rpc_apply";
 readonly sqlState: string | undefined;
 constructor(error: unknown) {
  super("Saved evaluation repair RPC failed");
  this.name = "SafeRepairCliError";
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  this.sqlState = safeSqlState(code);
 }
}
export function formatRepairCliError(error: unknown) {
 if (error instanceof SafeRepairCliError) return `Saved evaluation repair stopped at ${error.stage}${error.sqlState ? ` (SQLSTATE ${error.sqlState})` : ""}. No retry or provider call was made.`;
 return "Saved evaluation repair stopped; inspect private inputs and database guards. No retry or provider call was made.";
}
async function main(){
 for(let i=0;i<args.length;i++){if(["--plan","--output","--manifest","--manifest-sha256"].includes(args[i])){i++;continue;}if(!["--apply","--dry-run"].includes(args[i]))throw new Error("Unknown argument");}
 async function privatePath(path:string){const root=await realpath(resolve(homedir(),"Library/Application Support/SportsDesk/verification/private-verification")), parent=await realpath(dirname(resolve(path)));if(parent!==root&&!parent.startsWith(root+sep))throw new Error("Repair files must remain in private verification storage");return resolve(path);}
 const apply=args.includes("--apply"), planPath=option("--plan"), manifestPath=option("--manifest");
 if(apply&&args.includes("--dry-run"))throw new Error("Conflicting mode");
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error("Explicit database URL and service credential required");
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:WebSocket as unknown as typeof globalThis.WebSocket}});
 async function load(jobId:string){
  const {data:job,error}=await db.from("analysis_jobs").select("*").eq("id",jobId).single();if(error||!job)throw new Error("Saved job unavailable");
  const results=await Promise.all([db.from("analysis_attempts").select("*").eq("id",job.current_attempt_id).single(),db.from("messages").select("*").eq("id",job.result_message_id).single(),db.from("gateway_completions").select("*").eq("job_id",jobId).single(),db.from("sports").select("slug").eq("id",job.sport_id).single()]);
  if(results.some(x=>x.error||!x.data))throw new Error("Saved links unavailable");
  const [attempt,message,completion,sport]=results.map(x=>x.data!);
  if(job.status!=="completed"||attempt.status!=="completed"||attempt.owner_id!==job.owner_id||attempt.job_id!==job.id||message.owner_id!==job.owner_id||message.analysis_job_id!==job.id||message.sport_id!==job.sport_id||message.role!=="assistant"||completion.owner_id!==job.owner_id)throw new Error("Saved link mismatch");
  return {job,attempt,message,completion,sport};
 }
 if(apply){
  if(!manifestPath||planPath||!option("--manifest-sha256"))throw new Error("Apply requires reviewed manifest and SHA");
  const bytes=await readFile(await privatePath(manifestPath));if(sha256(bytes)!==option("--manifest-sha256"))throw new Error("Reviewed manifest digest mismatch");
  const manifest=JSON.parse(bytes.toString("utf8"));
  if(manifest.database_origin!==new URL(process.env.SUPABASE_URL).origin)throw new Error("Manifest database mismatch");
  if(manifest.version!==1||!Array.isArray(manifest.requests)||manifest.requests.length<1||manifest.requests.length>7)throw new Error("Invalid manifest");
  // Preflight every saved snapshot before the first possible mutation; RPC repeats locked CAS.
  const seen=new Set<string>(), verifiedRequests=[];
  for(const request of manifest.requests){
   if(seen.has(request.p_job_id))throw new Error("Duplicate manifest job");seen.add(request.p_job_id);
   const {job,attempt,message,completion,sport}=await load(request.p_job_id);
   if(job.owner_id!==request.p_owner_id||attempt.id!==request.p_attempt_id||message.id!==request.p_message_id||completion.original_attempt_id!==request.p_original_attempt_id||completion.raw_sha256!==request.p_expected_raw_sha256||completion.sources_sha256!==request.p_expected_source_map_sha256||sha256(message.content)!==request.p_expected_content_sha256)throw new Error("Manifest evidence changed");
   const context=JSON.parse(completion.input_snapshot.context),dateEt=context.analysis_scope?.date_et;
   if(context.sport!==sport.slug||typeof dateEt!=="string")throw new Error("Saved analysis scope unavailable");
   const fresh:SavedEvaluationInput={jobId:job.id,attemptId:attempt.id,originalAttemptId:completion.original_attempt_id,messageId:message.id,ownerId:job.owner_id,repairKey:request.p_repair_key,sport:sport.slug,dateEt,raw:completion.completion.result.text,sources:completion.completion.result.sources,rawSha256:completion.raw_sha256,sourcesSha256:completion.sources_sha256,content:message.content,expectedMetadata:message.metadata,reviewedTables:request.p_patch.evaluation_presentation.reviewedTables};
   verifiedRequests.push(verifyReviewedSavedEvaluationRepair(fresh,request));
  }
  for(const request of verifiedRequests){const {data,error}=await db.rpc("repair_saved_evaluation",request);if(error||!data||!["repaired","already_repaired"].includes(data.status))throw new SafeRepairCliError(error);console.log(JSON.stringify({job_id:request.p_job_id,status:data.status}));}
 }else{
  const output=option("--output");if(!planPath||!output||manifestPath)throw new Error("Dry-run requires private plan and output paths");
  const plan=JSON.parse(await readFile(await privatePath(planPath),"utf8"));if(plan.version!==1||!Array.isArray(plan.targets)||plan.targets.length<1||plan.targets.length>7)throw new Error("Invalid plan");
  const requests=[];const seen=new Set<string>();
  for(const target of plan.targets){
   if(seen.has(target.jobId))throw new Error("Duplicate target");seen.add(target.jobId);
   const {job,attempt,message,completion,sport}=await load(target.jobId);
   if(target.rawSha256!==completion.raw_sha256||target.sourcesSha256!==completion.sources_sha256)throw new Error("Planned checkpoint changed");
   const context=JSON.parse(completion.input_snapshot.context),dateEt=context.analysis_scope?.date_et;
   if(context.sport!==sport.slug||typeof dateEt!=="string"||target.dateEt!==dateEt)throw new Error("Planned scope differs from saved input");
   const input:SavedEvaluationInput={...target,dateEt,jobId:job.id,attemptId:attempt.id,originalAttemptId:completion.original_attempt_id,messageId:message.id,ownerId:job.owner_id,sport:sport.slug,raw:completion.completion.result.text,sources:completion.completion.result.sources,content:message.content,expectedMetadata:message.metadata};
   requests.push(deriveSavedEvaluationRepair(input).request);
  }
  const bytes=JSON.stringify({version:1,database_origin:new URL(process.env.SUPABASE_URL).origin,requests},null,2)+"\n";await writeFile(await privatePath(output),bytes,{mode:0o600,flag:"wx"});console.log(JSON.stringify({mode:"dry_run",count:requests.length,manifest_sha256:sha256(bytes)}));
 }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
 main().catch(error => { console.error(formatRepairCliError(error)); process.exitCode=1; });
}
