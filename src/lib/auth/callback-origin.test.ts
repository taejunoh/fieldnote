import { describe, expect, it } from "vitest";
import { getAuthCallbackOrigin } from "./callback-origin";

describe("auth callback origin", () => {
  it("uses the configured canonical origin instead of the internal production host", () => {
    expect(
      getAuthCallbackOrigin(
        "http://0.0.0.0:8080/auth/callback",
        "https://desk.example.com/some/path",
        "production",
      ),
    ).toBe("https://desk.example.com");
  });

  it("allows a localhost request origin as a development fallback", () => {
    expect(
      getAuthCallbackOrigin("http://localhost:3000/auth/callback", undefined, "development"),
    ).toBe("http://localhost:3000");
  });

  it("rejects non-local request origins when no canonical URL is configured", () => {
    expect(() =>
      getAuthCallbackOrigin("https://attacker.example/auth/callback", undefined, "development"),
    ).toThrow("APP_URL");
  });

  it("requires a secure canonical URL in production", () => {
    expect(() =>
      getAuthCallbackOrigin("http://0.0.0.0:8080/auth/callback", undefined, "production"),
    ).toThrow("APP_URL");
    expect(() =>
      getAuthCallbackOrigin(
        "http://0.0.0.0:8080/auth/callback",
        "http://desk.example.com",
        "production",
      ),
    ).toThrow("APP_URL");
    expect(() =>
      getAuthCallbackOrigin(
        "http://0.0.0.0:8080/auth/callback",
        "https://0.0.0.0:8080",
        "production",
      ),
    ).toThrow("APP_URL");
  });
});
