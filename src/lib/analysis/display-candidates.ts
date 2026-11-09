import { createHash } from "node:crypto";
import { z } from "zod";
import { sportSlugs } from "../sports";
import { dateInET } from "./coverage";
import { stableEventKey, sourcedEventKey } from "./record";
import type { StoredConditionalEntrySource } from "../records/entry-types";
import type { ConditionalBet } from "../latest-analysis-table";

const text = z.string().trim().min(1).max(2000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const d = new Date(`${value}T12:00:00Z`); return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === value; });
const instant = z.string().datetime({ offset: true });
const url = z.string().url().max(2000).refine(value => { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; });
export const displayCandidateSchema = z.object({
  item_key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/), event_key: text,
  market: z.string().trim().min(1).max(120), selection: z.string().trim().min(1).max(120),
  decision: z.enum(["BET", "GO", "EARLY GO"]), suggested_units: z.number().finite().positive().max(100),
  price_gate: z.string().trim().min(1).max(2000), source_url: url,
  schedule: z.object({ precision: z.enum(["not_before", "estimated", "date_only", "unknown"]), date_et: date, at: instant.nullable(), label: text }).strict(),
  status_at_assessment: z.enum(["scheduled", "unknown", "live", "final", "cancelled"]),
}).strict().superRefine((row, ctx) => {
  if ((["not_before", "estimated"].includes(row.schedule.precision) && row.schedule.at === null) ||
      (["date_only", "unknown"].includes(row.schedule.precision) && row.schedule.at !== null)) ctx.addIssue({ code: "custom", message: "Schedule precision and timestamp differ" });
  if (row.schedule.at && dateInET(new Date(row.schedule.at)) !== row.schedule.date_et) ctx.addIssue({ code: "custom", message: "Schedule date differs" });
});
export const displayCandidatesSchema = z.object({ version: z.literal(1), sport: z.enum(sportSlugs), candidates: z.array(displayCandidateSchema).max(20) }).strict().superRefine((value,ctx) => { if (new Set(value.candidates.map(row=>row.item_key)).size !== value.candidates.length || new Set(value.candidates.map(row=>`${row.event_key}|${row.market.toLowerCase()}|${row.selection.toLowerCase()}`)).size !== value.candidates.length) ctx.addIssue({code:"custom",message:"Duplicate candidate identity"}); });
export type DisplayCandidate = z.infer<typeof displayCandidateSchema>;
export type DisplayCandidateEnvelope = z.infer<typeof displayCandidatesSchema>;
const blockPattern = /^```analysis-candidates[^\S\r\n]*\r?\n[\s\S]*?^```[^\S\r\n]*(?:\r?\n|$)/gm;
/** Remove only closed dedicated blocks; malformed tails remain subject to the existing strict record parser. */
export function stripAnalysisCandidateBlocks(raw: string): string { return raw.replace(blockPattern, "").trim(); }
export function parseDisplayCandidateBlock(raw: string): DisplayCandidateEnvelope | null {
  const blocks = [...raw.matchAll(/^```analysis-candidates[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*(?:\r?\n|$)/gm)];
  if (blocks.length !== 1 || Buffer.byteLength(blocks[0][1],"utf8") > 65_536) return null;
  try { const parsed = displayCandidatesSchema.safeParse(JSON.parse(blocks[0][1])); return parsed.success ? parsed.data : null; } catch { return null; }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");
const inventorySchema = z.object({ event_key: text, label: text, starts_at: z.string().nullable(), source_url: url }).passthrough();
function rawInventory(raw: string, sport: string) {
  const blocks = [...raw.matchAll(/^```analysis-coverage[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*(?:\r?\n|$)/gm)];
  if (blocks.length !== 1 || Buffer.byteLength(blocks[0][1],"utf8") > 524_288) return null;
  try {
    const report = JSON.parse(blocks[0][1]);
    const parsed = z.object({ version: z.literal(1), scope: z.object({ sport: z.literal(sport), date_et: date }).passthrough(), inventory: z.array(inventorySchema).max(500), assessments: z.array(z.object({event_key:text,disposition:z.enum(["evaluated","deferred","excluded"])}).passthrough()).max(500) }).passthrough().safeParse(report);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
export type DisplayCandidateContext = { sport: string; ownerId?: string; jobId: string; messageId: string; raw: string; checkedAt: string; createdAt: string; deliveredAt: string; now: Date; commonPolicy: boolean };
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceSchema = z.object({role:z.enum(["recommendation","price","units","schedule","status"]),start:z.number().int().min(0),end:z.number().int().positive(),text,sha256:hash}).strict();
export const candidateOverlaySchema = z.object({owner_id:text,sport:z.enum(sportSlugs),job_id:text,message_id:text,raw_sha256:hash,checked_at:instant,created_at:instant,delivered_at:instant,envelope:displayCandidatesSchema.refine(value=>value.candidates.length===1),coverage:z.array(z.object({event_key:text,label:text,source_url:url,date_et:date}).strict()).length(1),evidence:z.array(evidenceSchema).min(5).max(20)}).strict();
export const candidateManifestSchema = z.object({version:z.literal(1),entries:z.array(candidateOverlaySchema).max(20)}).strict();
export type CandidateOverlay = z.infer<typeof candidateOverlaySchema>;
export function verifyConditionalCandidates(context: DisplayCandidateContext, canonicalRows: unknown[], overlays: CandidateOverlay[] = [], canonicalEvents: unknown[] = []): {bets:(ConditionalBet & { snapshot: StoredConditionalEntrySource })[];reasons:string[]} {
  const { raw, sport, now } = context;
  const times = [context.checkedAt, context.createdAt, context.deliveredAt].map(Date.parse);
  if (!times.every(Number.isFinite) || !Number.isFinite(now.valueOf()) || times[0] > Math.max(times[1], times[2]) || Math.max(...times) > now.valueOf()) return {bets:[],reasons:[]};
  const inventory = rawInventory(raw, sport);
  if (!inventory) return {bets:[],reasons:[]};
  const reasons:string[]=[];
  const original = parseDisplayCandidateBlock(raw);
  if (!original && /^```analysis-candidates\s*$/m.test(raw)) reasons.push("conditional_candidates_invalid");
  const envelopes: { envelope: DisplayCandidateEnvelope; sourceKind: "original_block" | "reviewed_overlay" }[] = original ? [{envelope:original,sourceKind:"original_block"}] : [];
  for (const overlay of overlays) {
    if (overlay.owner_id !== context.ownerId || overlay.sport !== sport || overlay.job_id !== context.jobId || overlay.message_id !== context.messageId || overlay.raw_sha256 !== sha(raw) || overlay.checked_at !== context.checkedAt || overlay.created_at !== context.createdAt || overlay.delivered_at !== context.deliveredAt || !candidateOverlaySchema.safeParse(overlay).success) continue;
    const bytes=Buffer.from(raw,"utf8");
    if (new Set(overlay.evidence.map(e=>e.role)).size!==5 || !overlay.evidence.every(e => e.end>e.start && e.end<=bytes.length && bytes.subarray(e.start,e.end).toString("utf8")===e.text && sha(e.text)===e.sha256)) continue;
    const proof=overlay.coverage[0], candidate=overlay.envelope.candidates[0];
    if (proof.event_key!==candidate.event_key || proof.source_url!==candidate.source_url || proof.date_et!==candidate.schedule.date_et || !inventory.inventory.some(e=>e.event_key===proof.event_key && e.source_url===proof.source_url && e.label===proof.label)) continue;
    const parsed = displayCandidatesSchema.safeParse(overlay.envelope);
    if (parsed.success) envelopes.push({envelope:parsed.data,sourceKind:"reviewed_overlay"});
  }
  const normalizeKey=(key:unknown,sourceUrl:string):string|null=>{
    if(typeof key!=="string" || !stableEventKey(key,sport)) return null;
    if(key.endsWith(":src")) return sourcedEventKey(key,new URL(sourceUrl).href);
    if(/:src-[a-f0-9]{32}$/.test(key) && key!==sourcedEventKey(key.replace(/:src-[a-f0-9]{32}$/,":src"),new URL(sourceUrl).href)) return null;
    return key;
  };
  const output: (ConditionalBet & { snapshot: StoredConditionalEntrySource })[] = [];
  for (const {envelope,sourceKind} of envelopes) {
    if (envelope.sport !== sport) continue;
    for (const row of envelope.candidates) {
      if (!["scheduled", "unknown"].includes(row.status_at_assessment) || !row.event_key.startsWith(`${sport}:${row.schedule.date_et}:`) || !stableEventKey(row.event_key, sport)) continue;
      if (!context.commonPolicy && row.decision !== "BET") continue;
      if (context.commonPolicy && ![0.25, 0.5, 1, 2].includes(row.suggested_units)) continue;
      const eventKey=normalizeKey(row.event_key,row.source_url);
      if(!eventKey) continue;
      const matches = inventory.inventory.filter(event => normalizeKey(event.event_key,event.source_url) === eventKey && new URL(event.source_url).href === new URL(row.source_url).href);
      if (matches.length !== 1 || inventory.inventory.filter(event => normalizeKey(event.event_key,event.source_url) === eventKey).length !== 1 || inventory.assessments.some(a=>normalizeKey(a.event_key,row.source_url)===eventKey && a.disposition==="excluded")) continue;
      const existing=canonicalRows.filter(value=>object(value) && normalizeKey(value.event_key,row.source_url)===eventKey && String(value.market).trim().toLowerCase()===row.market.toLowerCase() && String(value.selection).trim().toLowerCase()===row.selection.toLowerCase()) as Record<string,unknown>[];
      if (existing.length) {
        if (existing.some(value=>!["BET",...(context.commonPolicy?["GO","EARLY GO"]:[])].includes(String(value.decision)) || value.price_gate!==row.price_gate || value.suggested_units!==row.suggested_units)) reasons.push("conditional_canonical_conflict");
        continue;
      }
      if (matches[0].starts_at !== null) continue;
      const knownEvents=canonicalEvents.filter(value=>object(value) && typeof value.source_url==="string" && normalizeKey(value.event_key,value.source_url)===eventKey) as Record<string,unknown>[];
      const knownStarts=knownEvents.map(event=>typeof event.starts_at==="string"?Date.parse(event.starts_at):NaN).filter(Number.isFinite);
      if(knownStarts.some(start=>start<=Math.max(...times))) continue;
      const candidateSha256 = sha(JSON.stringify({sourceKind,itemKey:row.item_key,eventKey,market:row.market,selection:row.selection,originalDecision:row.decision,suggestedUnits:row.suggested_units,priceGate:row.price_gate,schedule:row.schedule,statusAtAssessment:row.status_at_assessment,sourceUrl:row.source_url}));
      const entrySource = {kind:"conditional_candidate" as const,sourceKind,jobId:context.jobId,messageId:context.messageId,itemKey:row.item_key,rawSha256:sha(raw),candidateSha256};
      const snapshot: StoredConditionalEntrySource = {version:1,provenance:"manual_confirmed_conditional",source:entrySource,eventKey,match:matches[0].label,market:row.market,selection:row.selection,originalDecision:row.decision,suggestedUnits:row.suggested_units,priceGate:row.price_gate,schedule:{precision:row.schedule.precision,dateEt:row.schedule.date_et,at:row.schedule.at,label:row.schedule.label},checkedAt:context.checkedAt,createdAt:context.createdAt,deliveredAt:context.deliveredAt,sourceUrl:row.source_url,statusAtAssessment:row.status_at_assessment as "scheduled"|"unknown"};
      output.push({ snapshot, entrySource, eventKey, match: matches[0].label, startsAt: null, displayOnly: true, market: row.market, selection: row.selection, suggestedUnits: row.suggested_units, priceGate: row.price_gate, checkedAt: context.checkedAt, messageId: context.messageId, jobId: context.jobId, schedule: { precision: row.schedule.precision, dateEt: row.schedule.date_et, at: row.schedule.at, label: row.schedule.label }, statusAtAssessment: row.status_at_assessment as "scheduled" | "unknown" });
    }
  }
  return {bets:output.filter(row => output.filter(other => other.eventKey===row.eventKey && other.market.toLowerCase()===row.market.toLowerCase() && other.selection.toLowerCase()===row.selection.toLowerCase()).length===1),reasons:[...new Set(reasons)]};
}

/** Current display eligibility is independent of immutable historical source validity. */
export function projectConditionalBets(context: DisplayCandidateContext, canonicalRows: unknown[], overlays: CandidateOverlay[] = [], canonicalEvents: unknown[] = []): {bets:ConditionalBet[];reasons:string[]} {
  const verified=verifyConditionalCandidates(context,canonicalRows,overlays,[]);
  const reasons=[...verified.reasons];
  const bets=verified.bets.filter(row=>{
    if(row.schedule.dateEt < dateInET(context.now)) return false;
    const known=canonicalEvents.filter(value=>object(value) && typeof value.event_key==="string" && typeof value.source_url==="string" && (value.event_key===row.eventKey || (value.event_key.endsWith(":src") && sourcedEventKey(value.event_key,new URL(value.source_url).href)===row.eventKey)));
    const starts=known.map(value=>object(value)&&typeof value.starts_at==="string"?Date.parse(value.starts_at):NaN).filter(Number.isFinite);
    if(starts.length) {if(starts.some(start=>start<=context.now.valueOf())) reasons.push("conditional_known_start_passed");return false;}
    return true;
  }).map(({snapshot,...row})=>{ void snapshot;return row;});
  return {bets,reasons:[...new Set(reasons)]};
}
