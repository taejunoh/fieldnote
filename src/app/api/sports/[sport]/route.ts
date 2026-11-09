import { evaluationPresentationDisplayFromMetadata } from "../../../../lib/analysis/evaluation-recovery-server";
import { entryCandidatesForMessage, publicEntryCandidate, mayHaveConditionalEntrySource } from "../../../../lib/records/conditional-entry";
import { loadPrivateDisplayCandidates } from "../../../../lib/analysis/private-display-candidates";
import { presentRecommendationEvaluations } from "../../../../lib/records/recommendation-evaluation";
import { apiError, requireOwner } from "@/lib/supabase/server";
import { getOrCreateSport, isSportSlug } from "@/lib/analysis/data";
import { recordRecoveryFromMetadata } from "@/lib/record-recovery";
import { evaluationDisplayFromMetadata } from "../../../../lib/analysis/evaluation";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sport: string }> },
) {
  try {
    const { sport: slug } = await params;
    if (!isSportSlug(slug))
      return Response.json({ error: "Unknown sport" }, { status: 404 });
    const { supabase, user } = await requireOwner();
    const sport = await getOrCreateSport(supabase, user.id, slug);
    const url = new URL(request.url);
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit")) || 40, 1),
      100,
    );
    const before = url.searchParams.get("before");
    if (before && Number.isNaN(Date.parse(before)))
      return Response.json({ error: "Invalid before cursor" }, { status: 400 });
    let messageQuery = supabase
      .from("messages")
      .select("*")
      .eq("owner_id", user.id)
      .eq("sport_id", sport.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (before) messageQuery = messageQuery.lt("created_at", before);
    const specs = [
      ["criteria_versions", "criteria", 100, "created_at"],
      ["events", "events", 200, "updated_at"],
      ["recommendations", "recommendations", 30, "created_at"],
      ["bets", "bets", 200, "created_at"],
      ["mistake_notes", "mistakes", 30, "created_at"],
      ["recommendation_evaluations", "recommendationEvaluations", 200, "created_at"],
      ["conversation_summaries", "summaries", 10, "created_at"],
      ["analysis_jobs", "jobs", 30, "created_at"],
    ] as const;
    // Active work must remain discoverable even when newer history fills the list.
    // Page explicitly because PostgREST caps each response at 1000 rows.
    const activeJobsPromise = (async () => {
      const jobs: { id: string; created_at: string; [key: string]: unknown }[] = [];
      const pageSize = 1000;
      let afterId: string | undefined;
      for (;;) {
        let query = supabase
          .from("analysis_jobs")
          .select("*")
          .eq("owner_id", user.id)
          .eq("sport_id", sport.id)
          .in("status", ["queued", "running"])
          .order("id", { ascending: true })
          .limit(pageSize);
        // A stable cursor avoids skipping rows when earlier active jobs finish.
        if (afterId) query = query.gt("id", afterId);
        const result = await query;
        if (result.error) throw result.error;
        jobs.push(...(result.data || []));
        if (!result.data || result.data.length < pageSize) return jobs;
        afterId = jobs[jobs.length - 1].id;
      }
    })();
    const [messageResult, activeJobs, ...results] = await Promise.all([
      messageQuery,
      activeJobsPromise,
      ...specs.map(([table, , count, order]) => {
        let query = supabase
          .from(table)
          .select(table==="recommendation_evaluations"?"*,successors:recommendation_evaluation_successors(id)":"*")
          .eq("owner_id", user.id)
          .eq("sport_id", sport.id)
          .order(order, { ascending: false })
        if (table === "events") query = query.order("id", { ascending: false });
        return query.limit(count);
      }),
    ]);
    if (messageResult.error) throw messageResult.error;
    const state: Record<string, unknown> = {};
    results.forEach((result, index) => {
      if (result.error) throw result.error;
      state[specs[index][1]] = result.data || [];
    });
    state.recommendationEvaluations = presentRecommendationEvaluations(state.recommendationEvaluations as Record<string,unknown>[]);
    const recentJobs = state.jobs as typeof activeJobs;
    state.jobs = [...new Map([...activeJobs, ...recentJobs].map((job) => [job.id, job])).values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const pageMessages=(messageResult.data || []).slice(0,limit);
    const overlays=await loadPrivateDisplayCandidates();
    const potentialMessages=pageMessages.filter(message=>mayHaveConditionalEntrySource(user.id,sport.id,slug,message,overlays));
    const sourceJobIds=[...new Set(potentialMessages.map(message=>message.analysis_job_id as string))];
    const sourceJobsResult=sourceJobIds.length ? await supabase.from("analysis_jobs").select("id,owner_id,sport_id,kind,status,result_type,result_message_id,current_attempt_id,provider_metadata").eq("owner_id",user.id).eq("sport_id",sport.id).in("id",sourceJobIds) : {data:[],error:null};
    if(sourceJobsResult.error) throw sourceJobsResult.error;
    const sourceJobs=new Map((sourceJobsResult.data||[]).map(job=>[job.id,job]));
    const attemptIds=[...new Set((sourceJobsResult.data||[]).map(job=>job.current_attempt_id).filter((id):id is string=>typeof id==="string"))];
    const attemptsResult=attemptIds.length ? await supabase.from("analysis_attempts").select("id,owner_id,job_id,status,provider_metadata,input_snapshot").eq("owner_id",user.id).in("id",attemptIds) : {data:[],error:null};
    if(attemptsResult.error) throw attemptsResult.error;
    const attempts=new Map((attemptsResult.data||[]).map(attempt=>[attempt.id,attempt]));
    const now=new Date();
    return Response.json({
      sport,
      messages: pageMessages.reverse().map(originalMessage => {
        const metadata = originalMessage.metadata && typeof originalMessage.metadata === "object" && !Array.isArray(originalMessage.metadata)
          ? { ...originalMessage.metadata }
          : originalMessage.metadata;
        if (metadata && typeof metadata === "object") {
          delete (metadata as Record<string, unknown>).original_model_response;
          delete (metadata as Record<string, unknown>).evaluation_presentation;
          delete (metadata as Record<string, unknown>).evaluation_quarantined_markets;
          delete (metadata as Record<string, unknown>).evaluation_report;
          delete (metadata as Record<string, unknown>).evaluation_validation;
        }
        const isAnalysis = originalMessage.role === "assistant" && (metadata as Record<string, unknown> | null)?.type === "analysis";
        const message={...originalMessage,metadata,conditionalEntrySources:entryCandidatesForMessage(user.id,sport.id,slug,originalMessage,sourceJobs.get(originalMessage.analysis_job_id),overlays,now,attempts.get(sourceJobs.get(originalMessage.analysis_job_id)?.current_attempt_id)).map(publicEntryCandidate),...(isAnalysis ? { evaluation: evaluationDisplayFromMetadata(originalMessage.metadata), evaluationPresentation: evaluationPresentationDisplayFromMetadata(originalMessage.metadata) } : {})};
        if (message.role !== "assistant" || message.metadata?.extraction_status !== "partial") return message;
        const recovery = recordRecoveryFromMetadata(originalMessage.metadata, {
          jobId: message.analysis_job_id, messageId: message.id, sport: slug,
        });
        return recovery?.status === "partial" ? { ...message, recovery } : message;
      }),
      hasMore: (messageResult.data || []).length > limit,
      ...state,
    },{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) {
    return apiError(error);
  }
}
