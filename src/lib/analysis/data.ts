import type { SupabaseClient } from "@supabase/supabase-js";
import { extractDocumentPurpose } from "../import/document-purpose";
import type { CommonPolicyVersion } from "../common-policy";
import { assembleContext, historicalDocumentExcerpts, type ContextRow } from "./context";
import { hasHistoricalComparisonIntent, parseStoredCoverageScope, resolveAnalysisScope } from "./coverage";

export type DatabaseClient = SupabaseClient;
export { sportSlugs, isSportSlug } from "../sports";

export async function getOrCreateSport(
  db: DatabaseClient,
  ownerId: string,
  slug: string,
) {
  const { data: existing, error } = await db
    .from("sports")
    .select("id,slug,created_at")
    .eq("owner_id", ownerId)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const inserted = await db
    .from("sports")
    .upsert({ owner_id: ownerId, slug }, { onConflict: "owner_id,slug" })
    .select("id,slug,created_at")
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

async function selectRows(
  db: DatabaseClient,
  table: string,
  ownerId: string,
  sportId: string,
  limit: number,
  order = "created_at",
  status?: string,
  before?: string,
) {
  let query = db
    .from(table)
    .select("*")
    .eq("owner_id", ownerId)
    .eq("sport_id", sportId);
  if (before) query = query.lt("created_at", before);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order(order, { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []) as ContextRow[];
}

const REVIEW_SOURCE_PAGE_SIZE = 100;
const REVIEW_SOURCE_MAX = 500;
async function selectReviewSources(
  db: DatabaseClient,
  ownerId: string,
  sportId: string,
  sportSlug: string,
  before: string,
  date?: string,
) {
  const rows: ContextRow[] = [];
  for (let offset = 0; offset <= REVIEW_SOURCE_MAX; offset += REVIEW_SOURCE_PAGE_SIZE) {
    const end = Math.min(offset + REVIEW_SOURCE_PAGE_SIZE, REVIEW_SOURCE_MAX + 1) - 1;
    let query = db.from("messages").select("id,role,created_at,coverage:metadata->coverage").eq("owner_id", ownerId).eq("sport_id", sportId)
      .eq("role", "assistant").eq("metadata->coverage->scope->>sport", sportSlug).lt("created_at", before);
    if (date) query = query.eq("metadata->coverage->scope->>date_et", date);
    const result = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, end);
    if (result.error) throw result.error;
    const page = (result.data || []) as ContextRow[];
    rows.push(...page.map(row => ({ id: row.id, role: row.role, created_at: row.created_at, metadata: { coverage: row.coverage } })));
    if (page.length < end - offset + 1 || rows.length > REVIEW_SOURCE_MAX) break;
  }
  const incomplete = rows.length > REVIEW_SOURCE_MAX;
  return { rows: rows.slice(0, REVIEW_SOURCE_MAX), incomplete };
}

async function selectReviewSourceDetails(db: DatabaseClient, ownerId: string, sportId: string, before: string, ids: string[]) {
  if (!ids.length) return [] as ContextRow[];
  const rows: ContextRow[] = [];
  for (let offset = 0; offset < ids.length; offset += REVIEW_SOURCE_PAGE_SIZE) {
    const batch = ids.slice(offset, offset + REVIEW_SOURCE_PAGE_SIZE);
    const result = await db.from("messages").select("*").eq("owner_id", ownerId).eq("sport_id", sportId).eq("role", "assistant")
      .in("id", batch).lt("created_at", before).limit(batch.length);
    if (result.error) throw result.error;
    rows.push(...(result.data || []) as ContextRow[]);
  }
  return rows;
}

export async function loadAnalysisContext(
  db: DatabaseClient,
  ownerId: string,
  sport: { id: string; slug: string },
  request: string,
  options: { kind?: string; now?: Date; requestCreatedAt?: string; requestMessageId?: string } = {},
) {
  const requestKind = options.kind || "analyze_today";
  const contextNow = options.now || new Date();
  const messageCutoff = requestKind === "review_results" ? options.requestCreatedAt || contextNow.toISOString() : options.requestCreatedAt;
  const [
    commonPolicyResult,
    userHistoryResult,
    criteria,
    events,
    messages,
    recommendations,
    bets,
    mistakes,
    summaries,
  ] = await Promise.all([
    db.from("common_policy_versions").select("*").eq("owner_id", ownerId).eq("status", "adopted").order("created_at", { ascending: false }).limit(2),
    db.from("messages").select("*").eq("owner_id", ownerId).eq("sport_id", sport.id).eq("role", "user").lt("created_at", options.requestCreatedAt || contextNow.toISOString()).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(101),
    selectRows(db, "criteria_versions", ownerId, sport.id, 100, "created_at", "adopted"),
    selectRows(db, "events", ownerId, sport.id, 30, "updated_at"),
    selectRows(db, "messages", ownerId, sport.id, 32, "created_at", undefined, messageCutoff),
    selectRows(db, "recommendations", ownerId, sport.id, 30),
    selectRows(db, "bets", ownerId, sport.id, 30),
    selectRows(db, "mistake_notes", ownerId, sport.id, 20),
    selectRows(db, "conversation_summaries", ownerId, sport.id, 6),
  ]);
  if (userHistoryResult.error) throw userHistoryResult.error;
  const originalUserHistory = (userHistoryResult.data || []) as ContextRow[];
  const userHistory: ContextRow[] = [];
  let historyChars = 0;
  for (const row of originalUserHistory.slice(0, 100)) {
    const length = typeof row.content === "string" ? row.content.length : 0;
    // Never shorten an original message: exclude whole older messages at the budget.
    if (historyChars + length > 60000) break;
    userHistory.push(row);
    historyChars += length;
  }
  const recentIds = new Set(messages.map(row => row.id));
  for (const row of userHistory) if (!recentIds.has(row.id)) messages.push(row);
  messages.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  if (commonPolicyResult.error) throw commonPolicyResult.error;
  if ((commonPolicyResult.data || []).length > 1) throw new Error("Multiple adopted common operating policies");
  const commonPolicy = (commonPolicyResult.data?.[0] || null) as CommonPolicyVersion | null;
  const explicitReviewScope = resolveAnalysisScope({ sport: sport.slug, request, kind: requestKind, now: contextNow, requestCreatedAt: messageCutoff });
  let reviewSourceHistoryIncomplete = false;
  if (requestKind === "review_results" && !/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(request)
    && !hasHistoricalComparisonIntent(request) && !explicitReviewScope.limitations.includes("invalid_or_ambiguous_request_date")) {
    const explicitDate = explicitReviewScope.scope.mode === "explicit" && explicitReviewScope.scope.basis === "request"
      ? explicitReviewScope.scope.date_et : undefined;
    const sourceResult = await selectReviewSources(db, ownerId, sport.id, sport.slug, messageCutoff!, explicitDate);
    reviewSourceHistoryIncomplete = sourceResult.incomplete;
    const candidateScope = resolveAnalysisScope({ sport: sport.slug, request, kind: requestKind, now: contextNow, requestCreatedAt: messageCutoff, messages: [...messages, ...sourceResult.rows], reviewSourceHistoryIncomplete });
    const candidateRows = sourceResult.rows.flatMap(row => {
      const scope = parseStoredCoverageScope(row.metadata, sport.slug);
      return row.role === "assistant" && typeof row.id === "string" && scope ? [{ id: row.id, date_et: scope.date_et }] : [];
    });
    const sameDateIds = [...new Set(candidateRows.filter(row => row.date_et === candidateScope.scope.date_et).map(row => row.id))];
    if (sameDateIds.length > 32) reviewSourceHistoryIncomplete = true;
    const selectedIds = reviewSourceHistoryIncomplete
      ? candidateScope.scope.parent_message_id ? [candidateScope.scope.parent_message_id] : []
      : sameDateIds;
    const selectedRows = await selectReviewSourceDetails(db, ownerId, sport.id, messageCutoff!, selectedIds);
    const seen = new Set(messages.map(row => row.id));
    for (const row of selectedRows) if (!seen.has(row.id)) messages.push(row);
    messages.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  }
  const referencedMessageIds = requestKind === "review_results"
    && explicitReviewScope.scope.mode === "explicit"
    && explicitReviewScope.scope.basis === "request"
    && !explicitReviewScope.limitations.includes("invalid_or_ambiguous_request_date")
    ? [...new Set((request.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi) || []).map(id => id.toLowerCase()))].slice(0, 100)
    : [];
  if (referencedMessageIds.length && messageCutoff) {
    const referencedResult = await db.from("messages").select("*")
      .eq("owner_id", ownerId).eq("sport_id", sport.id).eq("role", "assistant")
      .in("id", referencedMessageIds).lt("created_at", messageCutoff).limit(100);
    if (referencedResult.error) throw referencedResult.error;
    const seen = new Set(messages.map(row => row.id));
    for (const row of (referencedResult.data || []) as ContextRow[]) {
      if (!seen.has(row.id)) messages.push(row);
    }
    messages.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  }
  let reviewLedgerCoverage: ContextRow | undefined;
  if (requestKind === "review_results") {
    const reviewScope = resolveAnalysisScope({ sport: sport.slug, request, kind: requestKind, now: contextNow, requestCreatedAt: messageCutoff, messages, reviewSourceHistoryIncomplete });
    const unresolved = reviewScope.limitations.some(reason => ["review_scope_unresolved", "invalid_or_ambiguous_request_date", "review_source_history_incomplete"].includes(reason));
    const sources = messages.filter(row => row.role === "assistant" && (hasHistoricalComparisonIntent(request) || referencedMessageIds.includes(String(row.id).toLowerCase()) || parseStoredCoverageScope(row.metadata, sport.slug)?.date_et === reviewScope.scope.date_et));
    const sourceIds = sources.map(row => row.id).filter((id): id is string => typeof id === "string");
    let truncated = false;
    const exact = async (table: string, field: string, values: string[]) => {
      if (!values.length || unresolved) return [] as ContextRow[];
      const result = await db.from(table).select("*").eq("owner_id", ownerId).eq("sport_id", sport.id).in(field, [...new Set(values)]).order("id", { ascending: true }).limit(501);
      if (result.error) throw result.error;
      if ((result.data || []).length > 500) truncated = true;
      return ((result.data || []).slice(0, 500)) as ContextRow[];
    };
    const merge = (target: ContextRow[], additions: ContextRow[]) => {
      const seen = new Set(target.map(row => row.id));
      for (const row of additions) if (!seen.has(row.id)) { target.push(row); seen.add(row.id); }
    };
    merge(recommendations, await exact("recommendations", "source_message_id", sourceIds));
    const inventoryKeys = sources.flatMap(row => {
      const metadata = row.metadata as ContextRow | undefined;
      const inventory = (metadata?.coverage_report as ContextRow | undefined)?.inventory;
      const nativeEvents = (metadata?.analysis_record as ContextRow | undefined)?.events;
      return [inventory, nativeEvents].flatMap(items => Array.isArray(items) ? items.flatMap(item => item && typeof item === "object" && typeof item.event_key === "string" ? [item.event_key] : []) : []);
    });
    merge(events, await exact("events", "event_key", inventoryKeys));
    const sourceRecommendations = recommendations.filter(row => sourceIds.includes(String(row.source_message_id)));
    merge(events, await exact("events", "id", sourceRecommendations.map(row => row.event_id).filter((id): id is string => typeof id === "string")));
    const eventIds = [...new Set([...sourceRecommendations.map(row => row.event_id), ...events.filter(row => inventoryKeys.includes(String(row.event_key))).map(row => row.id)].filter((id): id is string => typeof id === "string"))];
    const scopedBets = await Promise.all([exact("bets", "source_message_id", sourceIds), exact("bets", "source_recommendation_id", sourceRecommendations.map(row => String(row.id))), exact("bets", "event_id", eventIds)]);
    for (const additions of scopedBets) merge(bets, additions);
    reviewLedgerCoverage = { complete_ledger: false, exact_source_and_event_queries: !unresolved, source_message_ids: sourceIds, event_ids: eventIds, query_limit: 500, truncated, unresolved_scope: unresolved, recent_record_limit: 30 };
  }
  // Optional recommendation semantics live in the immutable response record, not ledger columns.
  // Read the exact source message even after it leaves the recent conversation window.
  const recommendationSourceIds = [...new Set(recommendations
    .filter(row => typeof row.recommendation_item_key === "string")
    .map(row => row.source_message_id).filter((id): id is string => typeof id === "string"))];
  if (recommendationSourceIds.length) {
    const sourceResult = await db.from("messages").select("id,metadata")
      .eq("owner_id", ownerId).eq("sport_id", sport.id).in("id", recommendationSourceIds).limit(recommendationSourceIds.length);
    if (sourceResult.error) throw sourceResult.error;
    for (const row of recommendations) {
      const source = (sourceResult.data || []).find(message => message.id === row.source_message_id);
      const items = source?.metadata?.analysis_record?.recommendations;
      const recorded = Array.isArray(items) ? items.find((item: ContextRow) => item.item_key === row.recommendation_item_key && item.decision === row.decision) : null;
      if (recorded?.timing === "early") row.timing = "early";
      if (typeof recorded?.direction_note === "string" && recorded.direction_note.length <= 240) row.direction_note = recorded.direction_note;
    }
  }
  const documentIds = [...new Set([...criteria, ...events, ...messages, ...recommendations, ...bets, ...mistakes, ...summaries].map(row => row.source_document_id).filter((id): id is string => typeof id === "string"))].slice(0, 10);
  const documentSources: { source_document_id: string; sha256: string }[] = [];
  const documentPurposes: { source_document_id: string; sha256: string; purpose: string; source_ref: string }[] = [];
  const documentCutoff=options.requestCreatedAt || contextNow.toISOString();
  let documentQuery=db.from("imported_documents").select("id,sha256,raw_text,imported_at").eq("owner_id",ownerId).eq("sport_id",sport.id).lt("imported_at",documentCutoff);
  if(documentIds.length)documentQuery=documentQuery.in("id",documentIds);
  // Raw-only imports may have no structured row linking their source document yet.
  const documentResult=await documentQuery.order("imported_at",{ascending:false}).limit(documentIds.length?10:4);
  if(documentResult.error)throw documentResult.error;
  const historicalDocuments=(documentResult.data || []) as ContextRow[];
  for (const document of historicalDocuments) {
    documentSources.push({source_document_id:String(document.id),sha256:String(document.sha256)});
    const purpose=extractDocumentPurpose(String(document.raw_text));
    if(purpose)documentPurposes.push({source_document_id:String(document.id),sha256:String(document.sha256),purpose:purpose.purpose,source_ref:purpose.sourceRef});
  }
  const unavailableDocumentIds=documentIds.filter(id=>!historicalDocuments.some(doc=>doc.id===id));
  const historicalExcerpts={...historicalDocumentExcerpts(historicalDocuments,request,documentCutoff),
    source_candidate_limit:documentIds.length?10:4,
    candidate_scope:documentIds.length?"referenced_documents":"latest_import_fallback",
    unavailable_or_after_cutoff_referenced_ids:unavailableDocumentIds,
  };
  if(unavailableDocumentIds.length)historicalExcerpts.truncated=true;
  return assembleContext({
    sport: sport.slug,
    common_operating_policy: commonPolicy,
    now: options.now || new Date(),
    current_job_kind: options.kind || "analyze_today",
    request_created_at: messageCutoff,
    request_message_id: options.requestMessageId,
    review_source_history_incomplete: reviewSourceHistoryIncomplete,
    review_ledger_coverage: reviewLedgerCoverage,
    user_history_coverage: {
      limit: 100, character_budget: 60000, returned: userHistory.length,
      truncated: originalUserHistory.length > userHistory.length,
      before: options.requestCreatedAt || contextNow.toISOString(),
      oldest_returned_at: userHistory.at(-1)?.created_at || null,
      newest_returned_at: userHistory[0]?.created_at || null,
      source_message_ids: userHistory.map(row => row.id),
      meaning: "Bounded original user messages, not automatically adopted rules; older unavailable history may exist.",
    },
    historical_document_excerpts: historicalExcerpts,
    document_sources: documentSources,
    document_purposes: documentPurposes,
    request,
    criteria,
    events,
    messages: messages.reverse(),
    recommendations,
    bets,
    mistakes,
    summaries,
  });
}


/** Historic local acknowledgments remain replayable; new messages use the queue. */
export async function findLocalConversationRequest(db: DatabaseClient, ownerId: string, sportId: string, requestKey: string) {
  const { data, error } = await db.from("local_conversation_requests").select("request_key")
    .eq("owner_id", ownerId).eq("sport_id", sportId).eq("request_key", requestKey).maybeSingle();
  if (error) throw error;
  return data;
}
