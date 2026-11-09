function decimalRatio(value: number): { numerator: bigint; denominator: bigint } {
  const text = value.toString().toLowerCase();
  const [coefficient, exponentText] = text.split("e");
  const exponent = Number(exponentText ?? 0);
  const [whole, fraction = ""] = coefficient!.split(".");
  const digits = `${whole}${fraction}`;
  const scale = fraction.length - exponent;
  if (scale <= 0) {
    return {
      numerator: BigInt(digits) * BigInt(10) ** BigInt(-scale),
      denominator: BigInt(1),
    };
  }
  return {
    numerator: BigInt(digits),
    denominator: BigInt(10) ** BigInt(scale),
  };
}

function winningProfit(stake: number, price: number): number {
  const stakeRatio = decimalRatio(stake);
  const priceMagnitude = BigInt(Math.abs(price));
  const numerator =
    stakeRatio.numerator * (price > 0 ? priceMagnitude : BigInt(100));
  const denominator =
    stakeRatio.denominator * (price > 0 ? BigInt(100) : priceMagnitude);
  const scaledNumerator = numerator * BigInt(10_000);
  const rounded = (scaledNumerator + denominator / BigInt(2)) / denominator;
  return Number(rounded) / 10_000;
}

export function calculateBetProfit(
  result: string,
  stake: unknown,
  price: unknown,
): number | null {
  if (stake == null || price == null) return null;
  if (
    typeof stake !== "number" ||
    !Number.isFinite(stake) ||
    stake < 0 ||
    typeof price !== "number" ||
    !Number.isInteger(price) ||
    (price > -100 && price < 100)
  ) {
    return null;
  }

  if (result === "lost") return -stake;
  if (result === "push" || result === "void") return 0;
  if (result === "won") {
    const profit = winningProfit(stake, price);
    return Number.isFinite(profit) ? profit : null;
  }
  return null;
}
