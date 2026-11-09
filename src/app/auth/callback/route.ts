import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthCallbackOrigin } from "../../../lib/auth/callback-origin";

export async function GET(request: NextRequest) {
  const origin = getAuthCallbackOrigin(request.url);
  const redirect = (path: string) =>
    NextResponse.redirect(new URL(path, origin));
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const hasTokenParams =
    request.nextUrl.searchParams.has("token_hash") ||
    request.nextUrl.searchParams.has("type");
  const setupPassword =
    !code &&
    tokenHash &&
    type === "email" &&
    request.nextUrl.searchParams.get("setup") === "password";

  if ((!code && (!tokenHash || type !== "email")) || (code && hasTokenParams)) {
    return redirect("/?auth=invalid");
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: "email" });
    if (error) throw error;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (
      !user ||
      !process.env.OWNER_EMAIL ||
      user.email?.toLowerCase() !== process.env.OWNER_EMAIL.toLowerCase()
    ) {
      await supabase.auth.signOut();
      return redirect("/?auth=forbidden");
    }
    return redirect(setupPassword ? "/auth/password?setup=password" : "/");
  } catch {
    return redirect("/?auth=failed");
  }
}
