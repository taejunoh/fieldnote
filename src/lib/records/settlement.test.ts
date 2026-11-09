import { describe, expect, it } from "vitest";
import { calculateBetProfit } from "./settlement";

describe("calculateBetProfit", () => {
  it("rounds fractional stake winnings to four decimal places", () => {
    expect(calculateBetProfit("won", 0.25, 117)).toBe(0.2925);
    expect(calculateBetProfit("won", 0.25, -110)).toBe(0.2273);
  });

  it("returns null when either settlement input is missing", () => {
    expect(calculateBetProfit("lost", null, -110)).toBeNull();
    expect(calculateBetProfit("won", 1, null)).toBeNull();
  });

  it("rejects invalid stakes and non-integer or too-small American odds", () => {
    expect(calculateBetProfit("won", -1, 100)).toBeNull();
    expect(calculateBetProfit("won", Number.POSITIVE_INFINITY, 100)).toBeNull();
    expect(calculateBetProfit("won", 1, 99)).toBeNull();
    expect(calculateBetProfit("won", 1, -99)).toBeNull();
    expect(calculateBetProfit("won", 1, 110.5)).toBeNull();
  });

  it("returns null when a valid input pair overflows the numeric profit result", () => {
    expect(
      calculateBetProfit("won", Number.MAX_VALUE, Number.MAX_SAFE_INTEGER),
    ).toBeNull();
  });

  it("returns zero for a push or void with valid known inputs", () => {
    expect(calculateBetProfit("push", 2, -110)).toBe(0);
    expect(calculateBetProfit("void", 2, 125)).toBe(0);
  });
});
