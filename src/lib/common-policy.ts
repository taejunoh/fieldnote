import { z } from "zod";

export const COMMON_POLICY_MAX_BYTES = 128 * 1024;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return value.slice(0, 4) !== "0000" && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const originalContent = z.string().refine((value) => value.trim().length > 0, "Content required")
  .refine((value) => new TextEncoder().encode(value).byteLength <= COMMON_POLICY_MAX_BYTES, "Policy too large")
  .refine((value) => !value.includes("\0"), "Invalid content");

export const commonPolicyInputSchema = z.object({
  title: z.string().max(200).refine((value) => value.trim().length > 0 && !value.includes("\0")),
  versionDate: isoDate,
  content: originalContent,
  expectedVersionId: z.string().uuid().nullable(),
}).strict();

export const commonPolicyVersionSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  title: z.string(),
  version_date: isoDate,
  content: z.string(),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["adopted", "proposed", "superseded"]),
  supersedes_id: z.string().uuid().nullable(),
  created_at: z.string(),
});
export type CommonPolicyVersion = z.infer<typeof commonPolicyVersionSchema>;
export type CommonPolicyInput = z.infer<typeof commonPolicyInputSchema>;
export interface CommonPolicyResponse {
  current: CommonPolicyVersion | null;
  history: CommonPolicyVersion[];
}
