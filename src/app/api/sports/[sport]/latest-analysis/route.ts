import { verifiedEvaluationPresentation } from "../../../../../lib/analysis/evaluation-recovery-server";
import { apiError, requireOwner } from "@/lib/supabase/server";
import { getOrCreateSport, isSportSlug } from "@/lib/analysis/data";
import { coverageDisplayFromMetadata, evaluationDisplayFromMetadata, extractLatestAnalysisTable } from "../../../../../lib/latest-analysis-table";
import { recordRecoveryFromMetadata } from "../../../../../lib/record-recovery";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sport: string }> },
) {
  try {
    const { sport: slug } = await params;
    if (!isSportSlug(slug))
      return Response.json({ error: "Unknown sport" }, { status: 404, headers: noStoreHeaders });

    const { supabase, user } = await requireOwner();
    const sport = await getOrCreateSport(supabase, user.id, slug);
    const latest = await supabase
      .from("analysis_jobs")
      .select("id,kind,created_at,updated_at,result_message_id")
      .eq("owner_id", user.id)
      .eq("sport_id", sport.id)
      .eq("status", "completed")
      .or("result_type.is.null,result_type.eq.analysis")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw latest.error;
    if (!latest.data)
      return Response.json({ analysis: null }, { headers: noStoreHeaders });

    let extracted = {
      analysisTitle: null as string | null,
      tableTitle: null as string | null,
      tableMarkdown: null as string | null,
      hasTable: false,
    };
    let presentation: ReturnType<typeof verifiedEvaluationPresentation> = null;
    let savedBodyExists = false;
    let coverage: ReturnType<typeof coverageDisplayFromMetadata> = null;
    let evaluation: ReturnType<typeof evaluationDisplayFromMetadata> = null;
    let recovery = null as ReturnType<typeof recordRecoveryFromMetadata>;
    if (latest.data.result_message_id) {
      const result = await supabase
        .from("messages")
        .select("content,metadata")
        .eq("id", latest.data.result_message_id)
        .eq("owner_id", user.id)
        .eq("sport_id", sport.id)
        .eq("role", "assistant")
        .maybeSingle();
      if (result.error) throw result.error;
      if (result.data) {
        presentation = verifiedEvaluationPresentation(result.data.metadata);
        savedBodyExists = !!result.data.content?.trim();
        coverage = coverageDisplayFromMetadata(result.data.metadata);
        evaluation = evaluationDisplayFromMetadata(result.data.metadata);
        recovery = recordRecoveryFromMetadata(result.data.metadata, {
          jobId: latest.data.id,
          messageId: latest.data.result_message_id,
          sport: slug,
        });
        if (result.data.content) extracted = extractLatestAnalysisTable(result.data.content, presentation);
      }
    }

    return Response.json(
      {
        analysis: {
          jobId: latest.data.id,
          kind: latest.data.kind,
          completedAt: latest.data.updated_at,
          ...extracted,
          coverage,
          evaluation,
          savedBodyExists,
          evaluationPresentation: presentation ? { context: presentation.context, reason: presentation.reason } : null,
          ...(recovery ? { recovery } : {}),
        },
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
