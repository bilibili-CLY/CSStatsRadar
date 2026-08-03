import { describe, expect, it } from "vitest";
import type { MatchRecord } from "../../types";
import { filterMatches, recentMatchIDs } from "./selection";

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
});
