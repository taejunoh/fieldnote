import { createHash } from "node:crypto";
import { z } from "zod";
import { sportSlugs } from "../sports";
import { dateInET } from "./coverage";
import { officialSourceUrl, sourcedEventKey, stableEventKey } from "./record";
import type { DisplayCandidateContext } from "./display-candidates";
import type { ActionableBet } from "../latest-analysis-table";

const text=z.string().trim().min(1).max(2000);
const instant=z.string().datetime({offset:true});
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const d=new Date(`${value}T12:00:00Z`);return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===value;});
const url=z.string().url().max(2000).refine(value=>{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password;});
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const candidateSchema=z.object({item_key:z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),event_key:text,market:z.string().trim().min(1).max(120),selection:z.string().trim().min(1).max(120),decision:z.enum(["BET","GO","EARLY GO"]),suggested_units:z.number().finite().positive().max(100),price_gate:z.string().trim().min(1).max(2000),source_url:url,schedule:z.object({precision:z.literal("exact"),date_et:date,at:instant,label:text}).strict(),status_at_assessment:z.literal("scheduled")}).strict().superRefine((row,ctx)=>{if(dateInET(new Date(row.schedule.at))!==row.schedule.date_et)ctx.addIssue({code:"custom",message:"Schedule date differs"});});
// Separate from nonexact entry candidates: these rows can only open the original chat.
export const reviewedExactOverlaySchema=z.object({owner_id:text,sport:z.enum(sportSlugs),job_id:text,message_id:text,raw_sha256:hash,checked_at:instant,created_at:instant,delivered_at:instant,envelope:z.object({version:z.literal(1),sport:z.enum(sportSlugs),candidates:z.array(candidateSchema).length(1)}).strict(),coverage:z.array(z.object({event_key:text,label:text,source_url:url,date_et:date}).strict()).length(1),evidence:z.array(z.object({role:z.enum(["recommendation","price","units","schedule","status"]),start:z.number().int().min(0),end:z.number().int().positive(),text,sha256:hash}).strict()).min(5).max(20)}).strict();
export type ReviewedExactOverlay=z.infer<typeof reviewedExactOverlaySchema>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const normalize=(key:unknown,source:string,sport:string):string|null=>{
 if(typeof key!=="string"||!stableEventKey(key,sport))return null;
 const canonical=sourcedEventKey(key,new URL(source).href);
 if(key.endsWith(":src"))return canonical;
 if(/:src-[a-f0-9]{32}$/.test(key)&&key!==canonical)return null;
 return key;
};
export const exactBetIdentity=(row:{eventKey:string;market:string;selection:string})=>`${row.eventKey}|${row.market.trim().toLowerCase()}|${row.selection.trim().toLowerCase()}`;
/** Immutable source attestation is required by the caller before any reviewed body row is exposed. */
export function projectReviewedExactBets(context:DisplayCandidateContext & {sourceAttested:boolean;sources:unknown},overlays:ReviewedExactOverlay[],canonicalRows:unknown[],canonicalEvents:unknown[]):{bets:ActionableBet[];conflicts:string[];reasons:string[]} {
 const matching=overlays.some(o=>o.owner_id===context.ownerId&&o.sport===context.sport&&o.job_id===context.jobId&&o.message_id===context.messageId);
 const empty={bets:[],conflicts:[],reasons:matching?["reviewed_exact_evidence_unavailable"]:[]} as {bets:ActionableBet[];conflicts:string[];reasons:string[]};
 if(!context.sourceAttested)return empty;
 const times=[context.checkedAt,context.createdAt,context.deliveredAt].map(Date.parse),now=context.now.valueOf();
 if(!times.every(Number.isFinite)||!Number.isFinite(now)||times[0]>Math.max(times[1],times[2])||Math.max(...times)>now)return empty;
 const blocks=[...context.raw.matchAll(/^```analysis-coverage[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*(?:\r?\n|$)/gm)];
 if(blocks.length!==1||Buffer.byteLength(blocks[0][1])>524288)return empty;
 let inventory:Record<string,unknown>[],assessments:Record<string,unknown>[];
 try {const c=JSON.parse(blocks[0][1]);if(c.version!==1||c.scope?.sport!==context.sport||!Array.isArray(c.inventory)||c.inventory.length>500||!Array.isArray(c.assessments)||c.assessments.length>500||!c.inventory.every(object)||!c.assessments.every(object))return empty;inventory=c.inventory;assessments=c.assessments;}catch{return empty;}
 const output:ActionableBet[]=[],conflicts=new Set<string>();
 let admitted=0;
 const bytes=Buffer.from(context.raw,"utf8"),sources=Array.isArray(context.sources)?context.sources:[];
 const body=context.raw.replace(/^```(?:analysis-record|analysis-coverage|analysis-candidates|response-purpose)[^\S\r\n]*\r?\n[\s\S]*?^```[^\S\r\n]*(?:\r?\n|$)/gm,"");
 for(const value of overlays){
  const parsed=reviewedExactOverlaySchema.safeParse(value);if(!parsed.success)continue;
  const o=parsed.data,row=o.envelope.candidates[0],proof=o.coverage[0];
  if(o.owner_id!==context.ownerId||o.sport!==context.sport||o.envelope.sport!==context.sport||o.job_id!==context.jobId||o.message_id!==context.messageId||o.raw_sha256!==sha(context.raw)||o.checked_at!==context.checkedAt||o.created_at!==context.createdAt||o.delivered_at!==context.deliveredAt)continue;
  if(new Set(o.evidence.map(e=>e.role)).size!==5||!o.evidence.every(e=>e.end>e.start&&e.end<=bytes.length&&bytes.subarray(e.start,e.end).equals(Buffer.from(e.text,"utf8"))&&sha(e.text)===e.sha256))continue;
  if(proof.event_key!==row.event_key||proof.source_url!==row.source_url||proof.date_et!==row.schedule.date_et)continue;
  const key=normalize(row.event_key,row.source_url,context.sport),source=new URL(row.source_url).href;
  if(!key||!row.event_key.startsWith(`${context.sport}:${row.schedule.date_et}:`)||!officialSourceUrl(source,context.sport)||!sources.some(s=>object(s)&&s.url===source)||(!body.includes(row.source_url)&&!body.includes(source)))continue;
  const matches=inventory.filter(e=>typeof e.source_url==="string"&&url.safeParse(e.source_url).success&&normalize(e.event_key,e.source_url,context.sport)===key);
  if(matches.length!==1||matches[0].event_key!==proof.event_key||matches[0].source_url!==proof.source_url||matches[0].label!==proof.label||matches[0].starts_at!==row.schedule.at||assessments.some(a=>a.event_key===proof.event_key&&a.disposition==="excluded"))continue;
  const start=Date.parse(row.schedule.at);if(times.some(t=>t>=start)||(!context.commonPolicy&&row.decision!=="BET")||(context.commonPolicy&&![0.25,0.5,1,2].includes(row.suggested_units)))continue;
  const bet:ActionableBet={eventKey:key,match:proof.label,startsAt:row.schedule.at,market:row.market,selection:row.selection,suggestedUnits:row.suggested_units,priceGate:row.price_gate,checkedAt:context.checkedAt,messageId:context.messageId,jobId:context.jobId,provenance:"reviewed_original_body",originalDecision:row.decision,displayOnly:true};
  const identity=exactBetIdentity(bet);
  const existing=canonicalRows.filter(r=>object(r)&&normalize(r.event_key,row.source_url,context.sport)===key&&String(r.market).trim().toLowerCase()===row.market.toLowerCase()&&String(r.selection).trim().toLowerCase()===row.selection.toLowerCase()) as Record<string,unknown>[];
  const events=canonicalEvents.filter(e=>object(e)&&typeof e.source_url==="string"&&url.safeParse(e.source_url).success&&normalize(e.event_key,e.source_url,context.sport)===key) as Record<string,unknown>[];
  if(existing.some(r=>!["BET",...(context.commonPolicy?["GO","EARLY GO"]:[])].includes(String(r.decision))||r.suggested_units!==row.suggested_units||r.price_gate!==row.price_gate)||events.some(e=>e.starts_at!==row.schedule.at||["live","final","cancelled"].includes(String(e.status||e.status_at_assessment)))) {conflicts.add(identity);continue;}
  admitted++;
  if(start>now)output.push(bet);
 }
 const unique=new Map<string,ActionableBet>();
 for(const bet of output){const id=exactBetIdentity(bet),existing=unique.get(id);if(existing)conflicts.add(id);else unique.set(id,bet);}
 return {bets:[...unique].filter(([id])=>!conflicts.has(id)).map(([,bet])=>bet),conflicts:[...conflicts],reasons:conflicts.size?["reviewed_exact_canonical_conflict"]:matching&&!admitted?["reviewed_exact_evidence_unavailable"]:[]};
}
