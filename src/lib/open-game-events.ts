export type OpenGameEvent = {
  eventKey?: string;
  event_key?: string;
  analysisStatus?: string;
  analysis_status?: string;
  gameStatus?: string;
  game_status?: string;
  source_document_id?: string | null;
};

function newYorkDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function eventDate(event: OpenGameEvent) {
  const key = event.eventKey || event.event_key || "";
  return key.match(/(?:^|:)(\d{4}-\d{2}-\d{2})(?=[:\-]|$)/)?.[1];
}

function matchup(event: OpenGameEvent) {
  const key = event.eventKey || event.event_key || "";
  const date = eventDate(event);
  if (!date) return null;

  // Analysis records use an explicit away@home separator and may append an ID.
  const official = key.match(
    /(?:^|:)\d{4}-\d{2}-\d{2}:([^:@]+)@([^:@]+)(?::|$)/,
  );
  if (official) {
    return [date, ...[official[1], official[2]].sort()].join(":");
  }

  // WNBA event keys currently use exactly two short team codes after the date
  // for both imported claims and verified schedule rows (for example, -min-nyl).
  const shortCodePair = key.match(
    /(?:^|:)\d{4}-\d{2}-\d{2}-([a-z0-9]{2,4})-([a-z0-9]{2,4})$/i,
  );
  if (shortCodePair) {
    return [date, ...[shortCodePair[1].toLowerCase(), shortCodePair[2].toLowerCase()].sort()].join(":");
  }

  return null;
}

export function openGameEvents<T extends OpenGameEvent>(
  events: T[],
  now = new Date(),
) {
  const today = newYorkDate(now);
  const verifiedFutureMatchups = new Set(
    events
      .filter((event) => !event.source_document_id)
      .map(matchup)
      .filter((key): key is string => Boolean(key)),
  );

  return events.filter((event) => {
    const gameStatus = (event.gameStatus || event.game_status || "").toLowerCase();
    if (gameStatus === "final") return false;

    const date = eventDate(event);
    const isPastImportedEvent =
      Boolean(event.source_document_id) &&
      Boolean(date && date < today);

    const supersededFutureScheduleClaim =
      Boolean(event.source_document_id) &&
      Boolean(date && date >= today) &&
      Boolean(matchup(event) && verifiedFutureMatchups.has(matchup(event)!));

    return !isPastImportedEvent && !supersededFutureScheduleClaim;
  });
}
