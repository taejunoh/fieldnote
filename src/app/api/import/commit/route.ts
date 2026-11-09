import { requireOwner, apiError } from "@/lib/supabase/server";
import { sha256, validDraft, validImportInput } from "@/lib/import/validation";

export async function POST(request: Request) {
  try {
    const { supabase } = await requireOwner();
    const body: unknown = await request.json();
    if (
      !validImportInput(body) ||
      !validDraft((body as { draft?: unknown }).draft)
    ) {
      return Response.json(
        { error: "Valid import file and reviewed draft are required" },
        { status: 400 },
      );
    }
    const input = body as {
      sportSlug: string;
      filename: string;
      content: string;
      draft: unknown;
    };
    const { data, error } = await supabase.rpc("commit_import", {
      p_sport_slug: input.sportSlug,
      p_filename: input.filename,
      p_sha256: sha256(input.content),
      p_raw_text: input.content,
      p_draft: input.draft,
    });
    if (error) throw error;
    return Response.json(data);
  } catch (error) {
    return apiError(error);
  }
}
