import { describe, expect, it } from "vitest";
import { validateNewPassword } from "./password-validation";

describe("new password validation", () => {
  it("requires a password with at least twelve characters", () => {
    expect(validateNewPassword("short-password", "short-password")).toBeNull();
    expect(validateNewPassword("short-pass", "short-pass")).toBe(
      "비밀번호는 12자 이상이어야 합니다.",
    );
  });

  it("requires the confirmation to match", () => {
    expect(validateNewPassword("long-enough-password", "different-password")).toBe(
      "비밀번호가 일치하지 않습니다.",
    );
  });
});
