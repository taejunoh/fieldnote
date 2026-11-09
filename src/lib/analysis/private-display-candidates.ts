import { open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { reviewedExactOverlaySchema, type ReviewedExactOverlay } from "./reviewed-exact-bets";
import { candidateManifestSchema, candidateOverlaySchema, type CandidateOverlay } from "./display-candidates";

const overviewManifestSchema=z.object({version:z.literal(2),entries:z.array(candidateOverlaySchema).max(20),exact_entries:z.array(reviewedExactOverlaySchema).max(20)}).strict();
const empty=()=>({conditional:[] as CandidateOverlay[],exact:[] as ReviewedExactOverlay[]});
/** Server-only optional reviewed extraction; no request-controlled paths or remote fetches. */
export async function loadPrivateOverviewCandidates(): Promise<{conditional:CandidateOverlay[];exact:ReviewedExactOverlay[]}> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(join(process.cwd(), "private-display-candidates.json"), "r");
    const buffer = Buffer.alloc(65_537);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 65_536) return empty();
    const value=JSON.parse(buffer.subarray(0, length).toString("utf8"));
    const legacy=candidateManifestSchema.safeParse(value);
    if(legacy.success)return {conditional:legacy.data.entries,exact:[]};
    const parsed=overviewManifestSchema.safeParse(value);
    return parsed.success?{conditional:parsed.data.entries,exact:parsed.data.exact_entries}:empty();
  } catch { return empty(); }
  finally { await handle?.close().catch(() => undefined); }
}

/** Entry resolution deliberately ignores reviewed exact display rows. */
export async function loadPrivateDisplayCandidates():Promise<CandidateOverlay[]> {return (await loadPrivateOverviewCandidates()).conditional;}
