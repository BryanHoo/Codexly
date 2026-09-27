import { TaskStoreRegistry, estimateTaskStoreRetainedBytes, type TaskStoreRegistryOptions as SharedRegistryOptions } from "@codexly/frontend-core";
import type { TaskStore, TaskStoreIdentity } from "./task-store-core.js";
import { createTaskStore } from "./task-store-factory.js";

export { estimateTaskStoreRetainedBytes, TaskStoreRegistry };
export type TaskStoreRegistryOptions = Omit<SharedRegistryOptions<TaskStore>, "createStore"> & {
  createStore?: (identity: TaskStoreIdentity) => TaskStore;
};

export function createTaskStoreRegistry(options: TaskStoreRegistryOptions = {}): TaskStoreRegistry<TaskStore> {
  return new TaskStoreRegistry({ ...options, createStore: options.createStore ?? createTaskStore });
}
