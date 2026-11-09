import { describe, expect, it } from "vitest";
import { commonPolicyInputSchema } from "./common-policy";
const input = { title: "Policy", versionDate: "2026-10-06", content: " \n한글\r\n ", expectedVersionId: null };
describe("common policy input", () => {
  it("preserves original whitespace and UTF-8 text", () => {
    expect(commonPolicyInputSchema.parse(input)).toEqual(input);
  });
  it.each(["2026-02-30", "2025-02-29", "2026-13-01", "2026-1-01", "0000-01-01"])("rejects nonexistent or malformed date %s", (versionDate) => {
    expect(commonPolicyInputSchema.safeParse({ ...input, versionDate }).success).toBe(false);
  });
  it("requires an explicit revision even for first adoption", () => {
    const { expectedVersionId: _ignored, ...missing } = input;
    void _ignored;
    expect(commonPolicyInputSchema.safeParse(missing).success).toBe(false);
  });
  it("bounds UTF-8 bytes rather than characters and rejects blank policy", () => {
    expect(commonPolicyInputSchema.safeParse({ ...input, content: "한".repeat(45000) }).success).toBe(false);
    expect(commonPolicyInputSchema.safeParse({ ...input, content: " \n " }).success).toBe(false);
  });
  it("rejects browser supplied owner and malformed revision", () => {
    expect(commonPolicyInputSchema.safeParse({ ...input, owner_id: "other" }).success).toBe(false);
    expect(commonPolicyInputSchema.safeParse({ ...input, expectedVersionId: "wrong" }).success).toBe(false);
  });
});
