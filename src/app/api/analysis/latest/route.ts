import { verifiedEvaluationPresentation } from "../../../../lib/analysis/evaluation-recovery-server";
import { entryCandidatesForMessage } from "../../../../lib/records/conditional-entry";
import { attestAnalysisSource } from "../../../../lib/analysis/source-attestation";
import { loadPrivateOverviewCandidates } from "../../../../lib/analysis/private-display-candidates";
import { projectActionableBets } from "../../../../lib/analysis/actionable-bets";
import { sportSlugs } from "../../../../lib/analysis/data";
import { coverageDisplayFromMetadata, evaluationDisplayFromMetadata, extractLatestAnalysisTable } from "../../../../lib/latest-analysis-table";
import { recordRecoveryFromMetadata } from "../../../../lib/record-recovery";
import { apiError, requireOwner } from "@/lib/supabase/server";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const { supabase, user } = await requireOwner();
    const sportsResult = await supabase
      .from("sports")
      .select("id,slug")
      .eq("owner_id", user.id);
    if (sportsResult.error) throw sportsResult.error;

    const sportIds = new Map(
      (sportsResult.data ?? [])
        .filter((sport) => sportSlugs.some((slug) => slug === sport.slug))
        .map((sport) => [sport.slug, sport.id]),
    );

    const now = new Date();
    const {conditional:candidateOverlays,exact:reviewedExactOverlays} = await loadPrivateOverviewCandidates();
    const sports = await Promise.all(sportSlugs.map(async (sport) => {
      const sportId = sportIds.get(sport);
      if (!sportId) return { sport, analysis: null };

      const latest = await supabase
        .from("analysis_jobs")
        .select("id,kind,created_at,updated_at,result_message_id")
        .eq("owner_id", user.id)
        .eq("sport_id", sportId)
        .eq("status", "completed")
        .or("result_type.is.null,result_type.eq.analysis")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest.error) throw latest.error;
      if (!latest.data) return { sport, analysis: null };

      let projection = projectActionableBets({ sport, ownerId:user.id, candidateOverlays, jobId: latest.data.id, kind: latest.data.kind, now, message: null });
      let extracted = {
        analysisTitle: null as string | null,
        tableTitle: null as string | null,
        tableMarkdown: null as string | null,
        hasTable: false,
        savedBodyExists: false,
        evaluationPresentation: null as { context: "current" | "historical" | "unavailable"; reason: string } | null,
        coverage: null as ReturnType<typeof coverageDisplayFromMetadata>,
        evaluation: null as ReturnType<typeof evaluationDisplayFromMetadata>,
        recovery: null as ReturnType<typeof recordRecoveryFromMetadata>,
      };
      if (latest.data.result_message_id) {
        const result = await supabase
          .from("messages")
          .select("id,owner_id,sport_id,analysis_job_id,role,created_at,content,metadata")
          .eq("id", latest.data.result_message_id)
          .eq("owner_id", user.id)
          .eq("sport_id", sportId)
          .eq("role", "assistant")
          .maybeSingle();
        if (result.error) throw result.error;
        if (result.data) {
          projection = projectActionableBets({ sport, ownerId:user.id, candidateOverlays, jobId: latest.data.id, kind: latest.data.kind, now, message: result.data });
          const exactForMessage=reviewedExactOverlays.filter(row=>row.owner_id===user.id&&row.sport===sport&&row.job_id===latest.data!.id&&row.message_id===result.data!.id);
          if(projection.conditionalBets.length || exactForMessage.length) {
            const sourceJobResult=await supabase.from("analysis_jobs").select("id,owner_id,sport_id,kind,status,result_type,result_message_id,current_attempt_id,provider_metadata").eq("owner_id",user.id).eq("sport_id",sportId).eq("id",latest.data.id).maybeSingle();
            if(sourceJobResult.error) throw sourceJobResult.error;
            const sourceJob=sourceJobResult.data;
            const attemptResult=sourceJob?.current_attempt_id ? await supabase.from("analysis_attempts").select("id,owner_id,job_id,status,provider_metadata,input_snapshot").eq("owner_id",user.id).eq("job_id",sourceJob.id).eq("id",sourceJob.current_attempt_id).maybeSingle() : {data:null,error:null};
            if(attemptResult.error) throw attemptResult.error;
            const sourceAttested=attestAnalysisSource(user.id,sportId,sport,result.data,sourceJob||undefined,attemptResult.data||undefined);
            if(exactForMessage.length) {
              projection=projectActionableBets({sport,ownerId:user.id,candidateOverlays,reviewedExactOverlays:exactForMessage,sourceAttested,jobId:latest.data.id,kind:latest.data.kind,now,message:result.data});
              if(!sourceAttested){projection.actionState="unavailable";projection.actionReason="reviewed_exact_source_unavailable";projection.needsReview.count++;projection.needsReview.reasons=[...new Set([...projection.needsReview.reasons,"reviewed_exact_source_unavailable"])];}
            }
            const verified=entryCandidatesForMessage(user.id,sportId,sport,result.data,sourceJob||undefined,candidateOverlays,now,attemptResult.data||undefined);
            projection.conditionalBets=projection.conditionalBets.filter(row=>verified.some(candidate=>candidate.source.candidateSha256===row.entrySource.candidateSha256 && candidate.source.sourceKind===row.entrySource.sourceKind && candidate.source.itemKey===row.entrySource.itemKey));
          }
          const presentation = verifiedEvaluationPresentation(result.data.metadata);
          extracted.savedBodyExists = !!result.data.content?.trim();
          extracted.evaluationPresentation = presentation ? { context: presentation.context, reason: presentation.reason } : null;
          extracted.coverage = coverageDisplayFromMetadata(result.data.metadata);
          extracted.evaluation = evaluationDisplayFromMetadata(result.data.metadata);
          extracted.recovery = recordRecoveryFromMetadata(result.data.metadata, {
            jobId: latest.data.id,
            messageId: latest.data.result_message_id,
            sport,
          });
          if (result.data.content) {
            extracted = {
              ...extractLatestAnalysisTable(result.data.content, presentation),
              savedBodyExists: extracted.savedBodyExists,
              evaluationPresentation: extracted.evaluationPresentation,
              coverage: extracted.coverage,
              evaluation: extracted.evaluation,
              recovery: extracted.recovery,
            };
          }
        }
      }

      const { recovery, ...displayFields } = extracted;
      return {
        sport,
        analysis: {
          jobId: latest.data.id,
          kind: latest.data.kind,
          completedAt: latest.data.updated_at,
          ...displayFields,
          ...projection,
          ...(recovery ? { recovery } : {}),
        },
      };
    }));

    return Response.json({ sports }, { headers: noStoreHeaders });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
