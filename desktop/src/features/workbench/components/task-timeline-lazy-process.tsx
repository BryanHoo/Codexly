import { createLazyHistoryProcess } from "@codexly/ui/core/lazy-history-process";

import type { TurnProcessHistory as Process } from "./task-timeline-process-history.js";
type ProcessProps = Parameters<typeof Process>[0];

export const TurnProcessHistory = createLazyHistoryProcess<ProcessProps>(() =>
  import("./task-timeline-process-history.js").then((module) => ({ default: module.TurnProcessHistory })),
);
