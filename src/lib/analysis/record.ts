import { createHash } from "node:crypto";
import { recoverRecommendationKeys, type RecommendationKeyCorrection } from "./recommendation-key-recovery";
import { z } from "zod";
import type { GatewaySource } from "./gateway";
import { sportSlugs } from "../sports";

const sport = z.enum(sportSlugs);
const decision = z.enum(["WATCH", "WAIT", "BET", "PASS", "PAPER", "EVALUATION INCOMPLETE"]);
const event = z.object({
  event_key: z.string().max(160),
  label: z.string().trim().min(1).max(200),
  starts_at: z.string().datetime({ offset: true }).nullable(),
  source_url: z.string().url().max(2000),
  analysis_status: decision,
}).strict();
const recommendation = z.object({
  item_key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
  event_key: z.string().max(160),
  market: z.string().trim().min(1).max(120),
  selection: z.string().trim().min(1).max(120),
  decision,
  suggested_units: z.number().finite().min(0).max(100).nullable(),
  price_gate: z.string().trim().max(120).nullable(),
}).strict();
const schema = z.object({
  version: z.literal(1), sport,
  events: z.array(event).max(20),
  recommendations: z.array(recommendation).max(20),
}).strict();
const policyDecision = z.enum(["WATCH", "WAIT", "BET", "PASS", "PAPER", "EVALUATION INCOMPLETE", "GO", "EARLY GO", "LEAN"]);
const canonicalDecision = (value: z.infer<typeof policyDecision>): z.infer<typeof decision> =>
  value === "GO" || value === "EARLY GO" ? "BET" : value === "LEAN" ? "WATCH" : value;
const policySchema = schema.extend({
  events: z.array(event.extend({ analysis_status: policyDecision }).transform(row => ({ ...row, analysis_status: canonicalDecision(row.analysis_status) }))).max(20),
  recommendations: z.array(recommendation.extend({
    decision: policyDecision,
    timing: z.literal("early").optional(),
    direction_note: z.string().trim().min(1).max(240).optional(),
  }).transform(row => ({
    ...row,
    decision: canonicalDecision(row.decision),
    ...(row.decision === "EARLY GO" ? { timing: "early" as const } : {}),
    ...(row.decision === "LEAN" ? { direction_note: row.direction_note || row.selection } : {}),
  }))).max(20),
});
export type AnalysisRecord = z.infer<typeof policySchema>;
/** Reuse canonical validation in read-only projections before storage-source admission. */
export function canonicalRecordSchema(commonPolicyAdopted: boolean) {
  return commonPolicyAdopted ? policySchema : schema;
}
export type ExtractionFailure = { code: string; path: string; message: string };
export type RecordAdmission = {
  version: 1;
  raw_sha256: string;
  input_event_count: number;
  input_recommendation_count: number;
  accepted_event_keys: string[];
  accepted_recommendation_item_keys: string[];
  rejected_events: { index: number; event_key: string; code: "unverified_source" | "unofficial_source" | "uncited_source"; path: string }[];
  rejected_recommendations: { index: number; item_key: string; event_key: string; code: "rejected_event_dependency"; path: string }[];
};
export type ExtractedAnalysisRecord =
  | { answer: string; status: "complete"; record: AnalysisRecord; record_admission?: never; recommendation_key_corrections?: RecommendationKeyCorrection[]; failure?: never }
  | { answer: string; status: "partial"; record: AnalysisRecord; record_admission: RecordAdmission; recommendation_key_corrections?: RecommendationKeyCorrection[]; failure?: never }
  | { answer: string; status: "incomplete"; record: null; record_admission?: RecordAdmission; recommendation_key_corrections?: never; failure: ExtractionFailure };

function incomplete(text: string, code: string, path: string, message: string, record_admission?: RecordAdmission): ExtractedAnalysisRecord {
  return { answer: text.trim(), status: "incomplete", record: null, failure: { code, path, message }, ...(record_admission ? { record_admission } : {}) };
}

const officialHosts: Record<string, string[]> = {
  mlb: ["mlb.com"], nfl: ["nfl.com", "philadelphiaeagles.com"], cfb: ["ncaa.com", "collegefootballplayoff.com", "dsuhornets.com", "virginiasports.com", "uconnhuskies.com", "pennathletics.com", "tulsahurricane.com", "goairforcefalcons.com", "gostanford.com", "conferenceusa.com"],
  soccer: ["fifa.com", "uefa.com", "mlssoccer.com", "premierleague.com", "dcunited.com", "atlasfc.com.mx", "clubpuebla.com", "tuzos.com.mx", "clubsantos.mx", "bundesliga.com", "laliga.com", "acmonza.com", "ogcnice.com", "chicagostars.com", "reignfc.com", "thorns.com", "federacaopr.com.br", "atletico.com.br", "nashvillesc.com"],
  tennis: ["atptour.com", "wtatennis.com", "itftennis.com", "japanopentennis.com", "protennislive.com", "toray-ppo.com"],
  nba: ["nba.com"], wnba: ["wnba.com"], nhl: ["nhl.com"],
};
const exactOfficialHosts: Record<string, string[]> = {
  soccer: ["www.cbf.com.br"],
  tennis: ["wtafiles.wtatennis.com"],
  nba: ["ak-static.cms.nba.com"],
  nhl: ["frontend.d3.nhle.com"],
};

export function stableEventKey(key: string, slug: string) {
  const match = /^([a-z]+):(\d{4}-\d{2}-\d{2}):([a-z0-9][a-z0-9-]{1,39})@([a-z0-9][a-z0-9-]{1,39}):(id-[a-z0-9]{3,40}|src(?:-[a-f0-9]{32})?)$/.exec(key);
  if (!match || match[1] !== slug || match[3] === match[4]) return false;
  const day = new Date(`${match[2]}T00:00:00Z`);
  return !Number.isNaN(day.valueOf()) && day.toISOString().slice(0, 10) === match[2];
}

export function officialSourceUrl(raw: string, slug: string): boolean {
  const url = new URL(raw);
  return url.protocol === "https:" && !url.username && !url.password && !url.port &&
    (officialHosts[slug]?.some((host) => url.hostname === host || url.hostname === `www.${host}`) === true ||
      exactOfficialHosts[slug]?.includes(url.hostname) === true);
}

export function sourcedEventKey(key: string, url: string): string {
  return `${key.slice(0, key.lastIndexOf(":"))}:src-${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
}

export function extractAnalysisRecord(text: string, expectedSport: string, sources: GatewaySource[], checkedAt = new Date(), options: { commonPolicyAdopted?: boolean; scopeDate?: string; originalRawSha256?: string } = {}): ExtractedAnalysisRecord {
  const opening = text.lastIndexOf("```analysis-record");
  if (opening < 0) return incomplete(text, "missing_block", "analysis-record", "analysis-record 코드 블록이 없습니다.");
  const answer = text.slice(0, opening).trim();
  const block = text.slice(opening);
  const match = /^```analysis-record\s*\n([\s\S]*?)\n```\s*$/.exec(block);
  if (!match) return incomplete(text, "malformed_block", "analysis-record", "코드 블록이 닫히지 않았거나 응답 끝에 있지 않습니다.");
  let json: unknown;
  try { json = JSON.parse(match[1]); }
  catch { return incomplete(text, "invalid_json", "analysis-record", "코드 블록의 JSON을 파싱할 수 없습니다."); }
  const parsed = (options.commonPolicyAdopted ? policySchema : schema).safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return incomplete(text, "schema_invalid", issue.path.join(".") || "analysis-record", issue.message);
  }
  if (!answer) return incomplete(text, "missing_answer", "answer", "분석 본문이 없습니다.");
  const record = parsed.data;
  if (record.sport !== expectedSport) return incomplete(text, "wrong_sport", "sport", "요청 종목과 기록 종목이 다릅니다.");
  const sourceUrls = new Set(sources.map((source) => source.url));
  const eventKeys = new Set<string>();
  const normalizedKeys = new Map<string, string>();
  const eventSourceFailures = new Map<number, RecordAdmission["rejected_events"][number]>();
  const canonicalEventIndexes = new Map<string, number>();
  for (const [index, item] of record.events.entries()) {
    if (!stableEventKey(item.event_key, record.sport)) return incomplete(text, "invalid_event_key", `events.${index}.event_key`, "경기 키 형식 또는 상대 식별자가 올바르지 않습니다.");
    const originalKey = item.event_key;
    const citedUrl = item.source_url;
    const canonicalUrl = new URL(citedUrl).href;
    item.source_url = canonicalUrl;
    if (originalKey.endsWith(":src") || /:src-[a-f0-9]{32}$/.test(originalKey)) {
      const generatedKey = sourcedEventKey(originalKey, canonicalUrl);
      if (originalKey !== generatedKey && !originalKey.endsWith(":src"))
        return incomplete(text, "source_key_mismatch", `events.${index}.event_key`, "출처 URL과 경기 키가 일치하지 않습니다.");
      item.event_key = generatedKey;
    }
    if (!sourceUrls.has(canonicalUrl)) {
      eventSourceFailures.set(index, { index, event_key: originalKey, code: "unverified_source", path: `events.${index}.source_url` });
    } else if ((originalKey.endsWith(":src") || /:src-[a-f0-9]{32}$/.test(originalKey)) && !officialSourceUrl(canonicalUrl, record.sport)) {
        eventSourceFailures.set(index, { index, event_key: originalKey, code: "unofficial_source", path: `events.${index}.source_url` });
    } else if ((originalKey.endsWith(":src") || /:src-[a-f0-9]{32}$/.test(originalKey)) && !answer.includes(citedUrl) && !answer.includes(canonicalUrl)) {
        eventSourceFailures.set(index, { index, event_key: originalKey, code: "uncited_source", path: `events.${index}.source_url` });
    }
    if (eventKeys.has(item.event_key)) return incomplete(text, "duplicate_event_key", `events.${index}.event_key`, "경기 키가 중복되었습니다.");
    if (!options.commonPolicyAdopted && item.analysis_status === "EVALUATION INCOMPLETE" && (!item.starts_at || Date.parse(item.starts_at) > checkedAt.valueOf()))
      return incomplete(text, "invalid_evaluation_timing", `events.${index}.analysis_status`, "평가 미완료 상태에는 확인된 과거 경기 시작 시각이 필요합니다.");
    if (item.analysis_status === "BET" && (!item.starts_at || Date.parse(item.starts_at) <= checkedAt.valueOf()))
      return incomplete(text, "invalid_bet_timing", `events.${index}.analysis_status`, "BET 상태에는 확인된 미래 경기 시작 시각이 필요합니다.");
    eventKeys.add(item.event_key);
    normalizedKeys.set(originalKey, item.event_key);
    canonicalEventIndexes.set(item.event_key, index);
  }
  const recommendation_key_corrections = recoverRecommendationKeys(record, answer, sources, options.originalRawSha256 ?? createHash("sha256").update(text).digest("hex"), options.scopeDate);
  const itemKeys = new Set<string>();
  const rejectedRecommendations: RecordAdmission["rejected_recommendations"] = [];
  for (const [index, item] of record.recommendations.entries()) {
    const rawEventKey = item.event_key;
    item.event_key = normalizedKeys.get(item.event_key) || item.event_key;
    const linkedEventIndex = canonicalEventIndexes.get(item.event_key);
    if (linkedEventIndex === undefined) return incomplete(text, "unlinked_recommendation", `recommendations.${index}.event_key`, "추천이 확인된 경기와 연결되지 않았습니다.");
    if (itemKeys.has(item.item_key)) return incomplete(text, "duplicate_item_key", `recommendations.${index}.item_key`, "추천 키가 중복되었습니다.");
    const linked = record.events[linkedEventIndex];
    if (!options.commonPolicyAdopted && item.decision === "EVALUATION INCOMPLETE" && (!linked?.starts_at || Date.parse(linked.starts_at) > checkedAt.valueOf()))
      return incomplete(text, "invalid_evaluation_timing", `recommendations.${index}.decision`, "평가 미완료 판단에는 확인된 과거 경기 시작 시각이 필요합니다.");
    if (item.decision === "BET" && (!linked?.starts_at || Date.parse(linked.starts_at) <= checkedAt.valueOf()))
      return incomplete(text, "invalid_bet_timing", `recommendations.${index}.decision`, "BET 판단에는 확인된 미래 경기 시작 시각이 필요합니다.");
    if (options.commonPolicyAdopted) {
      if (item.decision === "BET" && ![0.25, 0.5, 1, 2].includes(item.suggested_units ?? -1))
        return incomplete(text, "invalid_recommended_units", `recommendations.${index}.suggested_units`, "새 BET 추천의 위험원금 등급은 0.25U, 0.5U, 1U 또는 2U여야 합니다.");
      if (item.decision !== "BET" && item.suggested_units !== null && item.suggested_units !== 0)
        return incomplete(text, "non_entry_units", `recommendations.${index}.suggested_units`, "진입 추천이 아닌 판단에는 권장 위험원금을 배정하지 않습니다.");
      if ("timing" in item && item.timing && item.decision !== "BET")
        return incomplete(text, "invalid_early_timing", `recommendations.${index}.timing`, "EARLY는 충분히 평가된 BET 추천의 진입 시점 구분입니다.");
    }
    if (eventSourceFailures.has(linkedEventIndex)) {
      rejectedRecommendations.push({ index, item_key: item.item_key, event_key: rawEventKey, code: "rejected_event_dependency", path: `recommendations.${index}.event_key` });
    }
    itemKeys.add(item.item_key);
  }

  if (!eventSourceFailures.size) return { answer, status: "complete", record, ...(recommendation_key_corrections.length ? { recommendation_key_corrections } : {}) };
  const rejectedEventIndexes = new Set(eventSourceFailures.keys());
  const acceptedEvents = record.events.filter((_, index) => !rejectedEventIndexes.has(index));
  const rejectedRecommendationIndexes = new Set(rejectedRecommendations.map((item) => item.index));
  const acceptedRecommendations = record.recommendations.filter((_, index) => !rejectedRecommendationIndexes.has(index));
  const admission: RecordAdmission = {
    version: 1,
    raw_sha256: options.originalRawSha256 ?? createHash("sha256").update(text).digest("hex"),
    input_event_count: record.events.length,
    input_recommendation_count: record.recommendations.length,
    accepted_event_keys: acceptedEvents.map((item) => item.event_key),
    accepted_recommendation_item_keys: acceptedRecommendations.map((item) => item.item_key),
    rejected_events: [...eventSourceFailures.values()],
    rejected_recommendations: rejectedRecommendations,
  };
  if (!acceptedEvents.length) {
    const firstRejected = admission.rejected_events[0];
    const messages = {
      unverified_source: "검색 결과에서 확인되지 않은 출처입니다.",
      unofficial_source: "공식 출처 허용목록에 등록되지 않은 호스트입니다.",
      uncited_source: "본문에 공식 출처 URL을 인용해야 합니다.",
    };
    return incomplete(text, firstRejected.code, firstRejected.path, messages[firstRejected.code], admission);
  }
  const acceptedKeys = new Set(admission.accepted_event_keys);
  const acceptedCorrectionKeys = new Set(acceptedRecommendations.map((item) => item.item_key));
  const filteredRecord: AnalysisRecord = {
    ...record,
    events: acceptedEvents,
    recommendations: acceptedRecommendations.filter((item) => acceptedKeys.has(item.event_key)),
  };
  const filteredCorrections = recommendation_key_corrections.filter((item) => acceptedCorrectionKeys.has(item.item_key));
  return {
    answer,
    status: "partial",
    record: filteredRecord,
    record_admission: admission,
    ...(filteredCorrections.length ? { recommendation_key_corrections: filteredCorrections } : {}),
  };
}
