import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth }),
}));

import { GET } from "./route";

function callbackRequest(query: string) {
  return new NextRequest(`http://0.0.0.0:8080/auth/callback${query}`);
}

async function locationFor(query: string) {
  const response = await GET(callbackRequest(query));
  return { response, location: response.headers.get("location") };
}

beforeEach(() => {
  vi.stubEnv("APP_URL", "https://desk.example.com");
  vi.stubEnv("OWNER_EMAIL", "owner@example.com");
  auth.exchangeCodeForSession.mockReset();
  auth.verifyOtp.mockReset();
  auth.getUser.mockReset();
  auth.signOut.mockReset();
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.getUser.mockResolvedValue({ data: { user: { email: "owner@example.com" } } });
  auth.signOut.mockResolvedValue({ error: null });
});

describe("auth callback", () => {
  it("verifies an email token hash and redirects to the canonical application URL", async () => {
    const tokenHash = "secret-token-hash";
    const { response, location } = await locationFor(
      `?token_hash=${tokenHash}&type=email`,
    );

    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: tokenHash, type: "email" });
    expect(response.status).toBe(307);
    expect(location).toBe("https://desk.example.com/");
    expect(location).not.toContain(tokenHash);
  });

  it("opens the fixed password setup route only for setup=password", async () => {
    const setup = await locationFor("?token_hash=secret&type=email&setup=password");
    const arbitrary = await locationFor(
      "?token_hash=secret&type=email&setup=other&next=https%3A%2F%2Fevil.example",
    );

    expect(setup.location).toBe(
      "https://desk.example.com/auth/password?setup=password",
    );
    expect(arbitrary.location).toBe("https://desk.example.com/");
    expect(arbitrary.location).not.toContain("evil.example");
  });

  it("continues to exchange legacy authorization codes", async () => {
    const { location } = await locationFor("?code=legacy-code");

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("legacy-code");
    expect(location).toBe("https://desk.example.com/");
  });

  it("signs out and denies a verified email that is not the owner", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { email: "other@example.com" } } });
    const { location } = await locationFor(
      "?token_hash=secret&type=email&setup=password",
    );

    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(location).toBe("https://desk.example.com/?auth=forbidden");
  });

  it("redirects failed email token verification without exposing the token", async () => {
    auth.verifyOtp.mockResolvedValue({ error: new Error("invalid token") });
    const { location } = await locationFor("?token_hash=secret&type=email");

    expect(location).toBe("https://desk.example.com/?auth=failed");
    expect(location).not.toContain("secret");
  });

  it("rejects unsupported or mixed callback parameters", async () => {
    const invalidType = await locationFor("?token_hash=secret&type=recovery");
    const mixed = await locationFor("?code=legacy&token_hash=secret&type=email");
    const missing = await locationFor("");

    expect(invalidType.location).toBe("https://desk.example.com/?auth=invalid");
    expect(mixed.location).toBe("https://desk.example.com/?auth=invalid");
    expect(missing.location).toBe("https://desk.example.com/?auth=invalid");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
