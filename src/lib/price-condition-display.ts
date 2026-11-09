import { formatOddsDisplay } from "./odds-display";

type Relation = { source: string; label: string };

const relations: Relation[] = [
  { source: "이상|at least|minimum|no less than|or better|or higher|or greater|or more|또는 더 유리한 가격|또는\\s+더\\s+좋은(?:\\s+(?:가격|배당))?|>=", label: "이상" },
  { source: "이하|at most|maximum|up to|no more than|or worse|or lower|or less|<=", label: "이하" },
  { source: "미만|less than|below|<", label: "미만" },
  { source: "초과|more than|above|>", label: "초과" },
];
function cleanAmericanOdds(value: string, relation: string) {
  const odds = /^([+-])(\d{2,4})$/.exec(value);
  if (!odds || Number(odds[2]) < 100) return null;
  const operator = relations.find(({ source }) => new RegExp(`^(?:${source})$`, "i").test(relation.trim()));
  if (!operator) return null;
  return `${odds[1]}${Number(odds[2])} ${operator.label}`;
}

function moneylineMarket(market: string) {
  return /(?:^|[^a-z])(?:moneyline|ml)(?:$|[^a-z])/i.test(market);
}

function spreadMarket(market: string) {
  return /(?:^|[^a-z])(?:spread|handicap|puck\s+line|run\s+line|point\s+spread)(?:$|[^a-z])/i.test(market);
}

function compactSpreadAndOdds(priceGate: string) {
  const match = /^\s*(?:[A-Z]{2,5}\s+)?([+-]\d+(?:\.\d+)?)(?:\s+(?:at|@|·)\s*|\s*\/\s*|에서\s*)(?:american\s*)?([+-]\d{2,4})\s+(이상|이하|미만|초과|or\s+better|or\s+worse|or\s+higher|or\s+lower|또는\s+더\s+좋은(?:\s+(?:가격|배당))?|at\s+least|at\s+most|minimum|maximum|no\s+less\s+than|no\s+more\s+than|>=|<=|<|>)/i.exec(priceGate);
  if (!match) return null;
  const tail = priceGate.slice(match[0].length);
  if (tail.trim() && /\d/.test(tail)) {
    const passTail = /^[\s.,;:–—-]*[+-]\d+(?:\.\d+)?(?:\s*(?:at|\/|@)\s*[+-]\d{2,4})?(?:은|는)?\s+PASS\b([\s\S]*)$/i.exec(tail);
    const lineException = /^[\s.,;:–—-]*[+-]\d+(?:\.5)?로\s+내려가면\s+같은\s+추천을\s+자동\s+이전하지\s+않는다\.?$/i.test(tail);
    if (!lineException && (!passTail || /\d|[+-]/.test(passTail[1]))) return null;
  }
  const odds = cleanAmericanOdds(match[2], match[3]);
  if (!odds || !Number.isFinite(Number(match[1].slice(1)))) return null;
  return `${match[1]} · ${odds}`;
}

function compactAllowedPrice(priceGate: string) {
  // Source text may list a worse observed quote first. Only an explicit "허용" clause
  // (or a single price with an explicit relation) is eligible as the threshold.
  const allowed = [...priceGate.matchAll(/허용\s*([+-]\d{2,4})\s*(이상|이하|미만|초과|or\s+better|or\s+worse|or\s+higher|or\s+lower|at\s+least|at\s+most|minimum|maximum|no\s+less\s+than|no\s+more\s+than|또는\s+더\s+유리한\s+가격|또는\s+더\s+좋은(?:\s+(?:가격|배당))?|>=|<=|<|>)?/gi)];
  const values = [...priceGate.matchAll(/([+-]\d{2,4})\s*(이상|이하|미만|초과|or\s+better|or\s+worse|or\s+higher|or\s+lower|at\s+least|at\s+most|minimum|maximum|no\s+less\s+than|no\s+more\s+than|또는\s+더\s+유리한\s+가격|또는\s+더\s+좋은(?:\s+(?:가격|배당))?|>=|<=|<|>)/gi)];
  if (values.length !== 1) return null;
  if (allowed.length === 1) {
    const relation = allowed[0][2];
    if (!relation) return null;
    return cleanAmericanOdds(allowed[0][1], relation);
  }

  return cleanAmericanOdds(values[0][1], values[0][2]);
}

/** Concise overview label plus the complete, display-formatted original condition. */
export function compactPriceCondition(priceGate: string, market: string) {
  const disclosure = formatOddsDisplay(priceGate, market);
  const isSpread = spreadMarket(market);
  const isMoneyline = moneylineMarket(market);
  if (isSpread) {
    const spreadAndOdds = compactSpreadAndOdds(priceGate);
    if (spreadAndOdds) return { summary: spreadAndOdds, disclosure };
    // A handicap with an unpaired price, or a price without its handicap, is ambiguous.
    return { summary: "조건 확인", disclosure };
  }
  if (!isMoneyline) {
    return { summary: "조건 확인", disclosure };
  }
  if (isMoneyline && (/\b(?:total|spread|handicap|run\s+line|puck\s+line|over|under)\b/i.test(priceGate) || /[+-]\d+(?:\.\d+)?\s*(?:\/|at\s+|에서\s*(?:american\s*)?)[+-]\d{2,4}/i.test(priceGate))) {
    return { summary: "조건 확인", disclosure };
  }
  if (/[;\n]/.test(priceGate)) {
    return { summary: "조건 확인", disclosure };
  }

  const allowedPrice = compactAllowedPrice(priceGate);
  if (allowedPrice) return { summary: allowedPrice, disclosure };

  if (isMoneyline) {
    const decimalDisplay = formatOddsDisplay(priceGate, market);
    const decimalMatch = /^([+-]\d+(?:\.\d+)?)\s*(.+)$/.exec(decimalDisplay.trim());
    if (decimalMatch) {
      const relation = relations.find(({ source }) => new RegExp(`^(?:${source})$`, "i").test(decimalMatch[2].trim()));
      if (relation && !/[;\n]|\b(?:total|spread|moneyline|market)\b/i.test(priceGate)) {
        const approximation = /[+-]\d+\.\d+/.test(decimalMatch[1]) ? "약 " : "";
        return { summary: `${approximation}${decimalMatch[1]} ${relation.label}`, disclosure };
      }
    }
  }

  return { summary: "조건 확인", disclosure };
}

/** Format a checked timestamp in the source's New York time zone, never the current time. */
export function formatCheckedAtEt(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return "시각 미확인";
  }
  const date = new Date(value);
  if (!value.trim() || !Number.isFinite(date.getTime())) return "시각 미확인";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (kind: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === kind)?.value || "";
  return `${part("month")}/${part("day")} ${part("hour")}:${part("minute")} ET`;
}
