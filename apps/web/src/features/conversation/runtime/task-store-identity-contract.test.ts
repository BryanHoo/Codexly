import { taskIdentityContract } from "@codexly/frontend-core/testing/task-identity-contract";
import { createTaskStore } from "./task-store.js";

taskIdentityContract((initial) =>
  createTaskStore({ projectId: "project", taskId: "task" }, initial),
);
