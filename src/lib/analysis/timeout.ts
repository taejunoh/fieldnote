export const DEFAULT_UPSTREAM_TIMEOUT_SECONDS = 2700;
export const MIN_UPSTREAM_TIMEOUT_SECONDS = 60;
export const MAX_UPSTREAM_TIMEOUT_SECONDS = 3600;
export const WORKER_TIMEOUT_MARGIN_SECONDS = 60;

export function parseUpstreamTimeoutSeconds(value: string | undefined): number {
  if (value === undefined) return DEFAULT_UPSTREAM_TIMEOUT_SECONDS;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error("OPENLLMS_UPSTREAM_TIMEOUT_SECONDS must be an integer from 60 to 3600");
  return validateUpstreamTimeoutSeconds(Number(normalized));
}

export function validateUpstreamTimeoutSeconds(value: number): number {
  if (!Number.isInteger(value) || value < MIN_UPSTREAM_TIMEOUT_SECONDS || value > MAX_UPSTREAM_TIMEOUT_SECONDS)
    throw new Error("OPENLLMS_UPSTREAM_TIMEOUT_SECONDS must be an integer from 60 to 3600");
  return value;
}

export function workerTransportTimeoutMs(upstreamTimeoutSeconds: number): number {
  return (validateUpstreamTimeoutSeconds(upstreamTimeoutSeconds) + WORKER_TIMEOUT_MARGIN_SECONDS) * 1000;
}
