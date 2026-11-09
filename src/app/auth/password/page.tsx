import { createElement } from "react";
import { redirect } from "next/navigation";
import PasswordSetupForm from "../../../components/password-setup-form";
import { requireOwner } from "../../../lib/supabase/server";

export default async function PasswordSetupPage() {
  try {
    await requireOwner();
  } catch {
    redirect("/");
  }

  return createElement(PasswordSetupForm);
}
