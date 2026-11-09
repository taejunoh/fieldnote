import { requireOwner, apiError } from "@/lib/supabase/server";
import { parseImport } from "@/lib/import/parser";
import { sha256, validImportInput } from "@/lib/import/validation";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireOwner();
    const body: unknown = await request.json();
    if (!validImportInput(body))
      return Response.json(
        { error: "Valid sport, filename, and MD content are required" },
        { status: 400 },
      );
    const hash = sha256(body.content);
    const { data: sport, error: sportError } = await supabase
      .from("sports")
      .select("id")
      .eq("owner_id", user.id)
      .eq("slug", body.sportSlug)
      .maybeSingle();
    if (sportError) throw sportError;
    let alreadyImported = false;
    if (sport) {
      const { data, error } = await supabase
        .from("imported_documents")
        .select("id")
        .eq("owner_id", user.id)
        .eq("sport_id", sport.id)
        .eq("sha256", hash)
        .maybeSingle();
      if (error) throw error;
      alreadyImported = !!data;
    }
    return Response.json({
      hash,
      draft: parseImport(body.content, body.sportSlug),
      alreadyImported,
    });
  } catch (error) {
    return apiError(error);
  }
}
