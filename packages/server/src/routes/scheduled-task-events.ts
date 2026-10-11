import type { FastifyInstance } from "fastify";
import type { Static } from "@sinclair/typebox";
import type { ScheduledTaskChangeSchema } from "@codexly/protocol";
import type { ServerRouteContext } from "./context.js";
import { registerResourceChangeEvents } from "./resource-change-events.js";

export function registerScheduledTaskEvents(app: FastifyInstance, context: ServerRouteContext) {
  registerResourceChangeEvents<Static<typeof ScheduledTaskChangeSchema>>(
    app,
    context,
    "/v1/scheduled-tasks/events",
    { type: "scheduled-tasks.changed" },
    (listener) =>
      context.scheduledTaskService.subscribe(() => {
        listener({ type: "scheduled-tasks.changed" });
      }),
  );
}
