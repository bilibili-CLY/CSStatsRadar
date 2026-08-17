import type { ImportSummary } from "../../types";

export function claimCompletedImport(completedJobs: Set<string>, summary: Pick<ImportSummary, "job_id" | "status"> | null) {
  if (!summary?.job_id || summary.status !== "completed" || completedJobs.has(summary.job_id)) return false;
  completedJobs.add(summary.job_id);
  return true;
}
