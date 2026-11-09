const acknowledgments = new Set([
  "들어갔어",
  "들어갔어요",
  "진입했어",
  "진입했어요",
  "베팅했어",
  "베팅했어요",
  "진입 완료",
  "베팅 완료",
]);

/** Recognize only a complete, standalone report that the user entered a bet. */
export function isEntryConfirmationAcknowledgment(text: string): boolean {
  if (/\u200b/u.test(text)) return false;

  const normalized = text
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!。！]$/u, "")
    .trim();

  return acknowledgments.has(normalized);
}
