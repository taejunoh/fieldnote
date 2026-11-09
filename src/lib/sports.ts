export const sportSlugs = [
  "mlb",
  "nfl",
  "cfb",
  "soccer",
  "tennis",
  "nba",
  "wnba",
  "nhl",
] as const;

export type SportSlug = (typeof sportSlugs)[number];

export function isSportSlug(value: unknown): value is SportSlug {
  return typeof value === "string" && sportSlugs.includes(value as SportSlug);
}
