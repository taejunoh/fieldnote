"use client";

import { FormEvent, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { validateNewPassword } from "@/lib/auth/password-validation";

export default function PasswordSetupForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateNewPassword(password, confirmation);
    if (validationError) {
      setMessage(validationError);
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      const client = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      setConfirmation("");
      setMessage("비밀번호를 설정했습니다. 이제 새 비밀번호로 로그인할 수 있습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "비밀번호를 설정하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-card" aria-labelledby="password-setup-title">
        <div className="kicker">PERSONAL SPORTS INTELLIGENCE / 001</div>
        <div className="auth-brand">
          FIELD<span>NOTE</span>
          <i>.</i>
        </div>
        <h1 id="password-setup-title">비밀번호 설정</h1>
        <p>다음 로그인부터 사용할 비밀번호를 설정해 주세요.</p>
        <form onSubmit={submit}>
          <label htmlFor="new-password">새 비밀번호</label>
          <div className="auth-input">
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <label htmlFor="confirm-password">비밀번호 확인</label>
          <div className="auth-input">
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
            />
          </div>
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? "설정 중…" : "비밀번호 저장"}
            {!submitting && <ArrowRight size={18} />}
          </button>
        </form>
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        <Link className="auth-back" href="/">
          데스크로 돌아가기
        </Link>
      </section>
      <div className="auth-motto">
        KEEP THE RECORD.
        <br />
        TRUST THE PROCESS.
      </div>
    </div>
  );
}
