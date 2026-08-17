import { describe, expect, it } from "vitest";
import { claimCompletedImport } from "./completion";

describe("claimCompletedImport", () => {
  it("claims a completion discovered by the first summary poll", () => {
    const completed = new Set<string>();
    expect(claimCompletedImport(completed, { job_id: "fast-job", status: "completed" })).toBe(true);
    expect(claimCompletedImport(completed, { job_id: "fast-job", status: "completed" })).toBe(false);
  });

  it("does not claim running jobs", () => {
    expect(claimCompletedImport(new Set(), { job_id: "running-job", status: "running" })).toBe(false);
  });
});
