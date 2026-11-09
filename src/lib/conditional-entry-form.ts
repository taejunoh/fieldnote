import type { ConditionalEntryCandidate, ConditionalEntrySource } from "./records/entry-types";

export type ConditionalEntryPayload = {
  sportSlug: string;
  source: ConditionalEntrySource;
  confirmed: true;
  idempotencyKey: string;
  stakeUnits: number | null;
  executedPrice: number | null;
};

export function conditionalEntryPreparationRequest(
  sportSlug: string,
  source: ConditionalEntrySource,
) {
  return { sportSlug, source };
}

export function conditionalEntrySignature(
  sportSlug: string,
  source: ConditionalEntrySource,
  stakeUnits: number | null,
  executedPrice: number | null,
) {
  return JSON.stringify([sportSlug, source, stakeUnits, executedPrice]);
}

export function conditionalEntryActuals(stakeInput: string, priceInput: string) {
  return {
    stakeUnits: stakeInput.trim() ? Number(stakeInput) : null,
    executedPrice: priceInput.trim() ? Number(priceInput) : null,
  };
}

export function conditionalEntryPayload(
  sportSlug: string,
  candidate: ConditionalEntryCandidate,
  stakeInput: string,
  priceInput: string,
  idempotencyKey: string,
): ConditionalEntryPayload {
  const { stakeUnits, executedPrice } = conditionalEntryActuals(stakeInput, priceInput);
  return {
    sportSlug,
    source: candidate.source,
    confirmed: true,
    idempotencyKey,
    stakeUnits,
    executedPrice,
  };
}
