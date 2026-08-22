import { describe, expect, it } from "vitest";
import type { MatchRecord } from "../../types";
import { filterMatches, playersWithStats, recentMatchIDs, sortPlayers } from "./selection";

const matches = [
  { demo_record_id: "3", map_name: "de_nuke", tags: ["赛事 A"] },
  { demo_record_id: "2", map_name: "de_dust2", tags: ["赛事 A", "半决赛"] },
  { demo_record_id: "1", map_name: "de_dust2", tags: ["训练"] },
] as MatchRecord[];

describe("library selection", () => {
  it("takes the latest N from the current filtered result", () => {
    const filtered = filterMatches(matches, "de_dust2", "赛事");
    expect(recentMatchIDs(filtered, 5)).toEqual(["2"]);
  });
  it("always selects at least one recent record when available", () => {
    expect(recentMatchIDs(matches, 0)).toEqual(["3"]);
  });

  it("keeps followed players first while sorting each group", () => {
    const players = [
      { steam_id: "a", name: "Alpha", followed: false, match_count: 4, latest_match_time: "2026-01-01", latest_imported_at: "2026-01-03" },
      { steam_id: "b", name: "Bravo", followed: true, match_count: 2, latest_match_time: "2026-01-01", latest_imported_at: "2026-01-02" },
      { steam_id: "c", name: "Charlie", followed: true, match_count: 5, latest_match_time: "2026-01-01", latest_imported_at: "2026-01-04" },
      { steam_id: "d", name: "Delta", followed: false, match_count: 1, latest_match_time: "2026-01-01", latest_imported_at: "2026-01-01" },
    ];
    expect(sortPlayers(players, "latest_imported").map((player) => player.steam_id)).toEqual(["c", "b", "a", "d"]);
    expect(sortPlayers(players, "match_count_asc").map((player) => player.steam_id)).toEqual(["b", "c", "d", "a"]);
    expect(sortPlayers(players, "match_count_desc").map((player) => player.steam_id)).toEqual(["c", "b", "a", "d"]);
  });

  it("keeps every player with usable match statistics for a bulk showcase", () => {
    const players = [
      { steam_id: "a", name: "Alpha", followed: false, match_count: 4 },
      { steam_id: "b", name: "Bravo", followed: true, match_count: 0 },
      { steam_id: "c", name: "Charlie", followed: true, match_count: 1 },
    ] as Parameters<typeof playersWithStats>[0];
    expect(playersWithStats(players).map((player) => player.steam_id)).toEqual(["a", "c"]);
  });
});
