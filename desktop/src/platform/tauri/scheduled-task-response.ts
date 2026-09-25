import { Value } from "@sinclair/typebox/value";
import { ScheduledTaskPreviewSchema, type ScheduledTaskPreview } from "@/protocol/scheduled-task.js";

export function parseScheduledTaskPreview(value: unknown): ScheduledTaskPreview {
  if (!Value.Check(ScheduledTaskPreviewSchema, value)) throw new Error("INVALID_SCHEDULE_PREVIEW");
  return value;
}
