import type { AgentModel } from "@codexly/protocol";
import type { AttachmentStore } from "./attachment-store.js";
import type { CreateCodexlyServerOptions } from "./server-options.js";
import type { ProjectContextResolver, ServerRouteContext } from "./routes/context.js";
import {
  ScheduledTaskService,
  createMemoryScheduledTaskRepository,
} from "./scheduled-task-service.js";
import { ScheduledTaskAttachmentManager } from "./scheduled-task-attachments.js";
import { assertValidProjectDefaults } from "./server-runtime.js";

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
    startTask: async (scheduled) => {
      const context = await getProjectContext(scheduled.projectId);
      if (context === undefined) throw new Error("Scheduled task project was not found");
      assertValidProjectDefaults(await listModels(), scheduled.turnOptions);
      const restored =
        scheduledTaskAttachmentManager === undefined
          ? { prompt: scheduled.prompt, restoredIds: [] }
          : await scheduledTaskAttachmentManager.restorePrompt(scheduled);
      try {
        // 先完成附件恢复再创建 Task，避免持久内容损坏时留下无 Turn 的孤儿 Task。
        const task = await context.provider.startTask();
        await options.settingsRepository.writeTaskSettings(
          scheduled.projectId,
          task.id,
          scheduled.turnOptions,
        );
        const { attachmentIds, providerInput } = await resolveProviderTurnInput(
          scheduled.projectId,
          restored.prompt,
          context.provider,
          task.id,
        );
        const turn = await context.provider.startTurn(
          task.id,
          providerInput,
          scheduled.turnOptions,
        );
        // Provider 确认启动后才消费恢复副本，失败时统一清理并记录本次运行失败。
        await attachmentStore.consume(
          scheduled.projectId,
          attachmentIds,
          turn.status === "running" ? turn.id : undefined,
        );
        return task.id;
      } catch (error) {
        await scheduledTaskAttachmentManager?.discard(restored.restoredIds);
        throw error;
      }
    },
  });
  await scheduledTaskService.start();
  return { scheduledTaskAttachmentManager, scheduledTaskService };
}
