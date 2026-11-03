import { runInterruptedReplyContract } from "@codexly/frontend-core/testing/interrupted-replies-contract";
import { createTaskStore } from "./task-store.js";

runInterruptedReplyContract((initial, storage) =>
  createTaskStore({ projectId: "project", taskId: "task" }, initial, storage),
);
