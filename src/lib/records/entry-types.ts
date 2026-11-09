/** Serializable client-safe references; the server always resolves these again. */
export type ConditionalEntrySource = {
  kind: 'conditional_candidate';
  sourceKind: 'original_block' | 'reviewed_overlay';
  jobId: string;
  messageId: string;
  itemKey: string;
  rawSha256: string;
  candidateSha256: string;
};
export type ConditionalEntryCandidate = {
  source: ConditionalEntrySource;
  eventKey: string;
  match: string;
  market: string;
  selection: string;
  originalDecision: 'BET' | 'GO' | 'EARLY GO';
  suggestedUnits: number;
  priceGate: string;
  schedule: { precision: 'not_before' | 'estimated' | 'date_only' | 'unknown'; dateEt: string; at: string | null; label: string };
  checkedAt: string;
  deliveredAt: string;
};
export type StoredConditionalEntrySource = ConditionalEntryCandidate & {
  version: 1;
  provenance: 'manual_confirmed_conditional';
  createdAt: string;
  sourceUrl: string;
  statusAtAssessment: 'scheduled' | 'unknown';
};
