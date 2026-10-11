import { ScheduledTaskChangeSchema } from "@codexly/protocol";
import type { WebSocketFactory } from "./event-client.js";
import { subscribeResourceChanges } from "./resource-change-events.js";

export function subscribeScheduledTaskChanges(
  baseUrl: string,
  factory: WebSocketFactory,
  onChange: () => void,
): () => void {
  return subscribeResourceChanges(
    baseUrl,
    factory,
    "/v1/scheduled-tasks/events",
    ScheduledTaskChangeSchema,
    onChange,
  );
}
