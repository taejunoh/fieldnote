import { requireOwner, apiError } from "@/lib/supabase/server";

export async function GET() {
  try {
    const { user } = await requireOwner();
    return Response.json({ id: user.id, email: user.email });
  } catch (error) {
    return apiError(error);
  }
}
