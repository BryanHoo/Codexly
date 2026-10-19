// 领域模型、用例和 Provider 端口只能从此公开入口导出。
export {
  CatalogSearchService,
  catalogSearchCursor,
  checkSearchCancellation,
  searchQuery,
} from "./catalog-search.js";
export { searchTextMatches, searchTextSnippet } from "./search-text.js";
export {
  type AgentCancellationSignal,
  type AgentModelCatalogFallback,
  type AgentFileSearchInput,
  type AgentFileSearchMatch,
  type AgentFileSearchProvider,
  type AgentProvider,
  type AgentProviderAttachment,
  type AgentProviderQueue,
  type AgentRuntimeProvider,
  type AgentEngineService,
  type AgentSearchProvider,
  type AgentSearchScope,
  type AgentTaskUnsubscribeStatus,
  type AgentProviderEvent,
  type AgentProviderEventListener,
  type AgentProviderEventSubscriptionOptions,
  type AgentProviderTaskSnapshot,
  type AgentProviderTurnInput,
  type AgentRuntimeDefaultSettings,
  type AgentTaskScope,
  type ListAgentTasksInput,
  type ListAgentQueuedSubmissionsInput,
  type ReadAgentTaskInput,
  PendingRequestResolutionError,
  type PendingRequestResolutionErrorCode,
  type ResolvePendingRequestInput,
  type StartAgentTaskOptions,
  type WorkbenchPetAsset,
  type WorkbenchPetProvider,
  WorkbenchPetProviderError,
  type WorkbenchPetProviderErrorCode,
} from "./agent-provider.js";
export {
  type AgentQueueRecord,
  type AgentQueueRepository,
  type AgentProviderConnectionRepository,
  type AgentSettingsRepository,
  type ProjectProjectionStore,
  type ProjectRepository,
  type ProjectSourceMigration,
  type RegisterProjectInput,
  type ScheduledTaskAttachmentRecord,
  type ScheduledTaskAttachmentRepository,
  type ScheduledTaskAttachmentReplacement,
  type ScheduledTaskRepository,
  type TaskRepository,
} from "./project.js";
export * from "./task-submission.js";
export * from "./project-todo.js";
export * from "./async-question.js";
export * from "./archived-task-deletion.js";
export * from "./task-catalog.js";
export * from "./completed-task-query.js";
export * from "./custom-model-reasoning.js";
export type * from "./local-catalog.js";
export {
  EngineProjectRouter,
  localTaskMetadata,
  type AgentExecutionAdapter,
} from "./engine-router.js";
export * from "./mcp-elicitation.js";
export * from "./task-snapshot-checkpoint.js";
export * from "./retained-work-budget.js";
export { boundTaskTitleInput, taskTitlePrompt, parseTaskTitle } from "./task-title.js";
export { readGenerationDefaults } from "./generation-defaults.js";
export type { TaskTitleGenerator } from "./agent-provider.js";
