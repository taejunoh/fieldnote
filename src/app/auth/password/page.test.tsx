import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("../../../lib/supabase/server", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("../../../components/password-setup-form", () => ({
  default: () => null,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import PasswordSetupPage from "./page";

beforeEach(() => {
  mocks.requireOwner.mockReset();
  mocks.redirect.mockReset();
  mocks.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("password setup page access", () => {
  it("redirects when the current session is not an owner session", async () => {
    mocks.requireOwner.mockRejectedValue(new Response("Sign in required", { status: 401 }));

    await expect(PasswordSetupPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it("renders the setup form for an authenticated owner", async () => {
    mocks.requireOwner.mockResolvedValue({
      user: { id: "owner", email: "owner@example.com" },
    });

    const page = await PasswordSetupPage();

    expect(mocks.requireOwner).toHaveBeenCalledOnce();
    expect(page).toBeDefined();
  });
});
