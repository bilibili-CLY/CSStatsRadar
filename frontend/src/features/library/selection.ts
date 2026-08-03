import type { MatchRecord } from "../../types";

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
