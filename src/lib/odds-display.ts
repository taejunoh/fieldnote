type PriceDirection = "lower" | "upper";

function isMoneylineMarket(market: string) {
  return /(?:^|[^a-z])moneyline(?:$|[^a-z])/i.test(market) || /(?:^|[^a-z])ml(?:$|[^a-z])/i.test(market);
}

function parseGate(priceGate: string, market: string) {
  const value = priceGate.trim();
  const prefixed = /^(?:decimal(?:\s+(?:odds|price))?\s*[:=]?\s*)(\d+(?:\.\d+)?)(.*)$/i.exec(value);
  const suffixed = prefixed ? null : /^(\d+(?:\.\d+)?)\s+decimal\s+(?:odds|price)(.*)$/i.exec(value);
  const direct = prefixed || suffixed || (isMoneylineMarket(market) ? /^(\d+(?:\.\d+)?)(.*)$/.exec(value) : null);
  if (!direct) return null;

  const token = direct[1];
  const suffix = direct[2];
  if (token.length > 24) return null;
  const relation = /^\s*(이상|이하|at least|at most|minimum|maximum|up to|no more than|no less than|or better|or worse|or higher|or lower|or greater|or less|or more|>=|<=)(?=$|[\s,;:(])/i.exec(suffix);
  if (suffix.trim() && !relation) return null;
  const direction: PriceDirection = relation && /^(?:이하|at most|maximum|up to|no more than|or worse|or lower|or less|<=)/i.test(relation[1])
    ? "upper"
    : "lower";
  return { token, suffix, direction };
}

function floorDiv(numerator: bigint, denominator: bigint) {
  const quotient = numerator / denominator;
  return numerator % denominator < BigInt(0) ? quotient - BigInt(1) : quotient;
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  const quotient = numerator / denominator;
  return numerator % denominator > BigInt(0) ? quotient + BigInt(1) : quotient;
}

function americanCents(token: string, direction: PriceDirection) {
  const [whole, fraction = ""] = token.split(".");
  const denominator = BigInt(10) ** BigInt(fraction.length);
  const decimal = BigInt(whole) * denominator + BigInt(fraction || "0");
  if (decimal <= denominator) return null;

  const numerator = decimal >= BigInt(2) * denominator
    ? BigInt(10_000) * (decimal - denominator)
    : BigInt(-10_000) * denominator;
  const divisor = decimal >= BigInt(2) * denominator ? denominator : decimal - denominator;
  return direction === "lower" ? ceilDiv(numerator, divisor) : floorDiv(numerator, divisor);
}

function formatCents(cents: bigint) {
  const sign = cents < BigInt(0) ? "-" : "+";
  const absolute = cents < BigInt(0) ? -cents : cents;
  const dollars = absolute / BigInt(100);
  const remainder = absolute % BigInt(100);
  return `${sign}${dollars}${remainder === BigInt(0) ? "" : `.${remainder.toString().padStart(2, "0")}`}`;
}

/** Display an unambiguous decimal-odds threshold as conservative American odds. */
export function formatOddsDisplay(priceGate: string, market: string) {
  const parsed = parseGate(priceGate, market);
  if (!parsed) return priceGate;
  const cents = americanCents(parsed.token, parsed.direction);
  if (cents === null) return priceGate;
  return `${formatCents(cents)}${parsed.suffix}`;
}
