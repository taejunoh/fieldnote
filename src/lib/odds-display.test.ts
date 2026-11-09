import { describe, expect, it } from "vitest";

import { formatOddsDisplay } from "./odds-display";

describe("display-only decimal odds formatting", () => {
  it("formats decimal moneyline thresholds as American odds", () => {
    expect(formatOddsDisplay("2.04 이상", "moneyline")).toBe("+104 이상");
    expect(formatOddsDisplay("2 이상", "full_game_moneyline")).toBe("+100 이상");
    expect(formatOddsDisplay("1.5 이상", "ML")).toBe("-200 이상");
  });

  it("rounds lower and upper fractional American thresholds conservatively", () => {
    expect(formatOddsDisplay("1.91 이상", "moneyline")).toBe("-109.89 이상");
    expect(formatOddsDisplay("1.91 이하", "moneyline")).toBe("-109.90 이하");
    expect(formatOddsDisplay("decimal odds 1.91 or better", "spread")).toBe("-109.89 or better");
  });

  it("preserves signed American prices, handicaps, units, dates, and mixed notes", () => {
    expect(formatOddsDisplay("+104 or better", "moneyline")).toBe("+104 or better");
    expect(formatOddsDisplay("-115", "moneyline")).toBe("-115");
    expect(formatOddsDisplay("+2.5 at -110 or better", "spread")).toBe("+2.5 at -110 or better");
    expect(formatOddsDisplay("Under 45.5 at 1.91", "total")).toBe("Under 45.5 at 1.91");
    expect(formatOddsDisplay("0.25U, 2.04 이상", "moneyline")).toBe("0.25U, 2.04 이상");
    expect(formatOddsDisplay("2026-10-27", "moneyline")).toBe("2026-10-27");
  });

  it("fails unchanged for ambiguous markets and invalid decimal odds", () => {
    expect(formatOddsDisplay("2.04 이상", "spread")).toBe("2.04 이상");
    expect(formatOddsDisplay("1.00 이상", "moneyline")).toBe("1.00 이상");
    expect(formatOddsDisplay("0.95 이하", "moneyline")).toBe("0.95 이하");
    expect(formatOddsDisplay("2.04 threshold noted in paragraph", "moneyline")).toBe("2.04 threshold noted in paragraph");
  });

  it("preserves suffix qualifiers exactly", () => {
    expect(formatOddsDisplay("2.04 이상 (Novig 기준)", "moneyline")).toBe("+104 이상 (Novig 기준)");
  });
});
