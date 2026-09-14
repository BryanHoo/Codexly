import type { AgentModel } from "@codexly/protocol";
import type { AttachmentStore } from "./attachment-store.js";
import type { CreateCodexlyServerOptions } from "./server-options.js";
import type { ProjectContextResolver, ServerRouteContext } from "./routes/context.js";
import {
  ScheduledTaskService,
  createMemoryScheduledTaskRepository,
} from "./scheduled-task-service.js";
import { ScheduledTaskAttachmentManager } from "./scheduled-task-attachments.js";
import { createScheduledSubmission } from "./scheduled-task-submission.js";
import { createMemorySubmissionRepository } from "./task-submission-service.js";

// 调度装配独立于 HTTP 应用入口，保持资源所有权与关闭顺序清晰。
export async function createScheduledTasks(
  options: CreateCodexlyServerOptions,
  attachmentStore: AttachmentStore,
  getProjectContext: ProjectContextResolver,
  listModels: () => Promise<readonly AgentModel[]>,
  resolveProviderTurnInput: ServerRouteContext["resolveProviderTurnInput"],
) {
  const scheduledTaskAttachmentManager =
    options.scheduledTaskAttachmentRepository === undefined
      ? undefined
      : new ScheduledTaskAttachmentManager(
          attachmentStore,
          options.scheduledTaskAttachmentRepository,
        );
  const scheduledTaskService = new ScheduledTaskService({
    ...(scheduledTaskAttachmentManager === undefined
      ? {}
      : {
          prepareTaskResources: (task) => scheduledTaskAttachmentManager.prepare(task),
        }),
    repository: options.scheduledTaskRepository ?? createMemoryScheduledTaskRepository(),
    ...createScheduledSubmission(
      options.submissionRepository ?? createMemorySubmissionRepository(1_000),
      options.settingsRepository,
      attachmentStore,
      scheduledTaskAttachmentManager,
      getProjectContext,
      listModels,
      resolveProviderTurnInput,
    ),
  });
  await scheduledTaskService.start();
  return { scheduledTaskAttachmentManager, scheduledTaskService };
}
