import { presentRecommendationEvaluations } from "../../../lib/records/recommendation-evaluation";
import { requireOwner, apiError } from "@/lib/supabase/server";
import { isSportSlug } from "@/lib/import/validation";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireOwner();
    const slug = new URL(request.url).searchParams.get("sport");
    if (!isSportSlug(slug))
      return Response.json({ error: "Invalid sport" }, { status: 400 });
    const { data: sport, error: sportError } = await supabase
      .from("sports")
      .select("id")
      .eq("owner_id", user.id)
      .eq("slug", slug)
      .maybeSingle();
    if (sportError) throw sportError;
    if (!sport)
      return Response.json({
        events: [],
        recommendations: [],
        bets: [],
        mistakeNotes: [],
        recommendationEvaluations: [],
      });
    const tables = [
      "events",
      "recommendations",
      "bets",
      "mistake_notes",
      "recommendation_evaluations",
    ] as const;
    const responses = await Promise.all(
      tables.map((table) =>
        supabase
          .from(table)
          .select(table==="recommendation_evaluations"?"*,successors:recommendation_evaluation_successors(id)":"*")
          .eq("sport_id", sport.id)
          .order(table === "events" ? "updated_at" : "created_at", {
            ascending: false,
          })
          .limit(200),
      ),
    );
    for (const response of responses) if (response.error) throw response.error;
    return Response.json({
      events: responses[0].data,
      recommendations: responses[1].data,
      bets: responses[2].data,
      mistakeNotes: responses[3].data,
      recommendationEvaluations: presentRecommendationEvaluations((responses[4].data || []) as unknown as Record<string,unknown>[]),
    });
  } catch (error) {
    return apiError(error);
  }
}
