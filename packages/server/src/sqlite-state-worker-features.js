import { createTaskQueueOperations } from "./sqlite-task-queue-worker.js";
import { createScheduledTaskOperations } from "./sqlite-state-worker-scheduled-tasks.js";
import { createSubmissionOperations } from "./sqlite-submission-worker.js";
import { createProjectTodoOperations } from "./sqlite-project-todo-worker.js";
import { createAsyncQuestionOperations } from "./sqlite-async-question-worker.js";
import { createLocalCatalogOperations } from "./local-catalog-worker.js";

export function createFeatureOperations(database) {
  // 各业务模块共用当前 Worker 的数据库连接和事务边界。
  return {
    ...createLocalCatalogOperations(database),
    ...createTaskQueueOperations(database),
    ...createScheduledTaskOperations(database),
    ...createSubmissionOperations(database),
    ...createProjectTodoOperations(database),
    ...createAsyncQuestionOperations(database),
  };
}
