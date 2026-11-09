import { apiError, requireOwner } from "@/lib/supabase/server";
import { SPORT_SLUGS } from "@/lib/import/validation";

export const runtime = "nodejs";

const JOBS_PER_SPORT = 50;
const ACTIVE_JOBS_PER_SPORT = 100;

export async function GET() {
  try {
    const { supabase, user } = await requireOwner();
    const sportsResult = await supabase
      .from("sports")
      .select("id,slug")
      .eq("owner_id", user.id)
      .in("slug", [...SPORT_SLUGS]);
    if (sportsResult.error) throw sportsResult.error;

    const sportRows = sportsResult.data || [];
    const jobsBySport = await Promise.all(
      sportRows.map(async (sport) => {
        const [recentResult, activeResult] = await Promise.all([
          supabase
          .from("analysis_jobs")
            .select("id,status,created_at,updated_at,attempt,dismissed_attempt,result_type")
          .eq("owner_id", user.id)
          .eq("sport_id", sport.id)
          .order("updated_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(JOBS_PER_SPORT),
          supabase
            .from("analysis_jobs")
            .select("id,status,created_at,updated_at,attempt,dismissed_attempt,result_type", { count: "exact" })
            .eq("owner_id", user.id)
            .eq("sport_id", sport.id)
            .in("status", ["queued", "running"])
            .order("updated_at", { ascending: false })
            .limit(ACTIVE_JOBS_PER_SPORT),
        ]);
        if (recentResult.error) throw recentResult.error;
        if (activeResult.error) throw activeResult.error;
        const jobs = [...new Map(
          [...(recentResult.data || []), ...(activeResult.data || [])].map((job) => [job.id, job]),
        ).values()].sort((a, b) =>
          b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id),
        );
        return [sport.slug, { jobs, activeCount: activeResult.count || 0 }] as const;
      }),
    );

    const jobs = Object.fromEntries(jobsBySport.map(([slug, value]) => [slug, value.jobs]));
    const activeCounts = Object.fromEntries(jobsBySport.map(([slug, value]) => [slug, value.activeCount]));
    return Response.json(
      { sports: SPORT_SLUGS, jobs, activeCounts },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
