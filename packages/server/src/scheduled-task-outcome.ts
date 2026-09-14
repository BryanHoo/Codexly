import type { ScheduledTaskRun } from "@codexly/protocol";

export class ScheduledTaskLaunchError extends Error {
  constructor(
    public readonly status: "unknown" | "cleanup_pending" | "failed",
    public readonly taskId: string | null,
  ) {
    super(
      status === "unknown"
        ? "Launch outcome is unknown; inspect the task before creating another schedule"
        : status === "cleanup_pending"
          ? "Launch confirmed; cleanup will be retried"
          : "Scheduled task could not be launched",
    );
  }
}

export function isUnresolvedScheduledRun(run: ScheduledTaskRun): boolean {
  return run.status === "unknown" || run.status === "cleanup_pending";
}
