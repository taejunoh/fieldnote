import { createHash } from 'node:crypto';
import { z } from 'zod';
export const APPROVED_TENNIS_SOURCE_MANIFEST_SHA256='ec37a6dcbe176dac4fdec9828b4fc5b0045ce8e52d77b3017ca6ed5e677798e2';
const sha=z.string().regex(/^[a-f0-9]{64}$/),instant=z.string().datetime({offset:true});
const manifestSchema=z.object({
 version:z.literal(1),sport:z.literal('tennis'),scope:z.literal('schedule_pair_and_date'),purpose:z.literal('independent_current_schedule_verification'),
 job_id:z.literal('5c0cbeef-6c15-4a51-9418-12031a088a6b'),message_id:z.literal('02472f0b-af35-49e8-ad30-4bbefd6f3593'),raw_sha256:z.literal('4f42583180bb523ca307e9a561d87a3573f2042e423a9fb69283aea586ebdeea'),
 original_checked_at:z.literal('2026-10-23T14:05:29.255Z'),date_et:z.literal('2026-10-23'),timezone:z.literal('America/New_York'),
 analysis_unchanged:z.literal(true),original_sources_unchanged:z.literal(true),original_start_values_unchanged:z.literal(true),
 does_not_verify:z.tuple([z.literal('original_search_membership'),z.literal('current_odds'),z.literal('actual_first_serve'),z.literal('full_scope_coverage')]),
 documents:z.array(z.object({source_url:z.string().url(),final_url:z.string().url(),http_status:z.literal(200),media_type:z.literal('application/pdf'),content_sha256:sha,content_bytes:z.number().int().positive(),fetched_at:instant,scope:z.literal('schedule_pair_and_date')}).strict()).length(3),
 events:z.array(z.object({event_key:z.string(),label:z.string(),source_url:z.string().url(),date_et:z.literal('2026-10-23'),opponents:z.tuple([z.string().min(1),z.string().min(1)]),original_starts_at:instant.nullable(),start_precision:z.string().min(1),original_searched_membership:z.boolean(),pair_date_confirmed:z.literal(true)}).strict()).length(8),
}).strict();
export type ApprovedSourceManifest=z.infer<typeof manifestSchema>;
export type IndependentSourceVerification={version:1;manifest_json:string;manifest_sha256:string};
const envelopeSchema=z.object({version:z.literal(1),manifest_json:z.string().min(1).max(100000),manifest_sha256:z.literal(APPROVED_TENNIS_SOURCE_MANIFEST_SHA256)}).strict();
/** A digest pinned by the separately reviewed source investigation is the authority;
 * model JSON and caller supplied hashes cannot create new verification authority. */
export function parseApprovedIndependentSourceVerification(envelope:unknown):ApprovedSourceManifest|null{
 const e=envelopeSchema.safeParse(envelope);if(!e.success||createHash('sha256').update(e.data.manifest_json,'utf8').digest('hex')!==APPROVED_TENNIS_SOURCE_MANIFEST_SHA256)return null;
 try{const m=manifestSchema.safeParse(JSON.parse(e.data.manifest_json));return m.success?m.data:null;}catch{return null;}
}
