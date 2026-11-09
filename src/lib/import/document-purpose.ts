/** A bounded historical workflow reference; never a source of fresh sports facts. */
export function extractDocumentPurpose(text: string): { purpose: string; sourceRef: string } | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let inFence = false;
  for (let index = 0; index < lines.length; index++) {
    if (/^\s*```/.test(lines[index])) { inFence = !inFence; continue; }
    if (inFence) continue;
    const heading = lines[index].match(/^(#{1,6})\s+(?:(?:\d+(?:\.\d+)*)[.)]?\s*)?(?:Purpose|목적)\s*:?[\s#]*$/i);
    if (!heading) continue;
    let end = index + 1;
    while (end < lines.length) {
      const next = lines[end].match(/^(#{1,6})\s+/);
      if (next && next[1].length <= heading[1].length) break;
      end++;
    }
    const purpose = lines.slice(index + 1, end).join("\n").trim().slice(0, 6000);
    return purpose ? { purpose, sourceRef: `L${index + 1}-L${end}` } : null;
  }
  return null;
}
