import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Response("Supabase is not configured", { status: 503 });
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        values: { name: string; value: string; options: CookieOptions }[],
      ) {
        try {
          values.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server components cannot set cookies; route handlers can.
        }
      },
    },
  });
}

export async function requireOwner(): Promise<{
  supabase: SupabaseClient;
  user: User;
}> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Response("Sign in required", { status: 401 });
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail)
    throw new Response("OWNER_EMAIL is not configured", { status: 503 });
  if (user.email?.toLowerCase() !== ownerEmail.toLowerCase()) {
    throw new Response("Access restricted to the owner account", {
      status: 403,
    });
  }
  return { supabase, user };
}

export function apiError(error: unknown): Response {
  if (error instanceof Response) return error;
  const message =
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "Unexpected error";
  return Response.json({ error: message }, { status: 500 });
}
