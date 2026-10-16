import type { MatchRecord, SavedPlayer } from "../../types";

export type PlayerSort = "latest_imported" | "match_count_asc" | "match_count_desc";

function dateValue(value: string | undefined) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sortPlayers(players: SavedPlayer[], sort: PlayerSort) {
  return [...players].sort((a, b) => {
    if (a.followed !== b.followed) return Number(b.followed) - Number(a.followed);
    const latestImported = dateValue(b.latest_imported_at) - dateValue(a.latest_imported_at);
    const bySort = sort === "match_count_asc"
      ? a.match_count - b.match_count
      : sort === "match_count_desc"
        ? b.match_count - a.match_count
        : latestImported;
    if (bySort) return bySort;
    if (latestImported) return latestImported;
    const byName = a.name.localeCompare(b.name, "zh-CN", { sensitivity: "base" });
    return byName || a.steam_id.localeCompare(b.steam_id);
  });
}

export function playersWithStats(players: SavedPlayer[]) {
  return players.filter((player) => player.match_count > 0);
}

export function filterMatches(
  matches: MatchRecord[],
  map: string,
  tag: string,
) {
  const needle = tag.trim().toLowerCase();
  return matches.filter(
    (match) =>
      (map === "all" || match.map_name === map) &&
      (!needle ||
        match.tags?.some((value) => value.toLowerCase().includes(needle))),
  );
}

export function recentMatchIDs(matches: MatchRecord[], count: number) {
  return matches
    .slice(0, Math.max(1, count))
    .map((match) => match.demo_record_id);
}

export type MatchGroupSort =
  | "time_desc"
  | "time_asc"
  | "kills"
  | "adr"
  | "rating";

export function sortGroupMatches(
  matches: MatchRecord[],
  sort: MatchGroupSort,
) {
  return [...matches].sort((a, b) => {
    let value = 0;
    switch (sort) {
      case "time_desc":
        value = dateValue(b.match_time) - dateValue(a.match_time);
        break;
      case "time_asc":
        value = dateValue(a.match_time) - dateValue(b.match_time);
        break;
      case "kills":
        value = b.kills - a.kills;
        break;
      case "adr":
        value = nullableDesc(a.adr, b.adr);
        break;
      case "rating":
        value = nullableDesc(a.rating, b.rating);
        break;
    }
    if (value) return value;
    return dateValue(b.match_time) - dateValue(a.match_time);
  });
}

function nullableDesc(a: number | null, b: number | null) {
  if (a != null && b != null) return b - a;
  if (a != null) return -1;
  if (b != null) return 1;
  return 0;
}
