import { createRouter } from "@tanstack/react-router";

import { indexRoute } from "./routes/index-route.js";
import { projectRoute } from "./routes/project-route.js";
import { projectFileRoute } from "./routes/project-file-route.js";
import { projectDraftRoute } from "./routes/project-draft-route.js";
import { rootRoute } from "./routes/root-route.js";
import {
  projectExtensionsRoute,
  temporaryExtensionsRoute,
} from "./routes/extensions-route.js";
import {
  projectTaskBoardRoute,
  temporaryTaskBoardRoute,
} from "./routes/task-board-route.js";
import { taskRoute } from "./routes/task-route.js";
import { temporaryRoute } from "./routes/temporary-route.js";
import { temporaryTaskRoute } from "./routes/temporary-task-route.js";
import { workbenchLayoutRoute } from "./routes/workbench-route.js";
import {
  projectScheduledTasksRoute,
  temporaryScheduledTasksRoute,
} from "./routes/scheduled-tasks-route.js";

const routeTree = rootRoute.addChildren([
  indexRoute,
  projectFileRoute,
  workbenchLayoutRoute.addChildren([
    projectRoute,
    projectDraftRoute,
    projectTaskBoardRoute,
    projectScheduledTasksRoute,
    projectExtensionsRoute,
    taskRoute,
    temporaryRoute,
    temporaryTaskBoardRoute,
    temporaryScheduledTasksRoute,
    temporaryExtensionsRoute,
    temporaryTaskRoute,
  ]),
]);

export const router = createRouter({
  defaultPreload: "intent",
  routeTree,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
