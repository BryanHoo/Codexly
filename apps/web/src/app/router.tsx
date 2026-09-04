import { createRouter } from "@tanstack/react-router";

import { indexRoute } from "./routes/index-route.js";
import { projectRoute } from "./routes/project-route.js";
import { projectTodoRoute } from "./routes/project-todo-route.js";
import { projectFileRoute } from "./routes/project-file-route.js";
import { rootRoute } from "./routes/root-route.js";
import { taskRoute } from "./routes/task-route.js";
import { projectTaskBoardRoute, temporaryTaskBoardRoute } from "./routes/task-board-route.js";
import { temporaryRoute } from "./routes/temporary-route.js";
import { temporaryTaskRoute } from "./routes/temporary-task-route.js";
import { workbenchLayoutRoute } from "./routes/workbench-route.js";

const routeTree = rootRoute.addChildren([
  indexRoute,
  projectFileRoute,
  workbenchLayoutRoute.addChildren([
    projectRoute,
    projectTodoRoute,
    projectTaskBoardRoute,
    taskRoute,
    temporaryRoute,
    temporaryTaskBoardRoute,
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
