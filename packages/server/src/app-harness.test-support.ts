import { vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import type { ProjectOpenService } from "./project-open.js";
import { closeCallbacks } from "./app.test-support.js";
import { createProvider } from "./app-provider.test-support.js";
import { createServerOptions, createSettingsRepository } from "./app-options.test-support.js";

// 仅在需要完整 Fastify 实例时创建 harness，并统一登记关闭回调。
export async function createHarness(
  options: Readonly<{
    idempotencyCacheSize?: number;
    modelCatalogCacheMaxBytes?: number;
    modelCatalogCacheTtlMs?: number;
    projectOpenService?: ProjectOpenService;
  }> = {},
) {
  const {
    archiveTask,
    clearGoal,
    compactTask,
    deleteTask,
    emitEvent,
    eventListeners,
    forkTask,
    interruptTurn,
    listBackgroundTerminals,
    listTasks,
    listMcpServers,
    listModels,
    listSkills,
    pinTask,
    provider,
    queue,
    readGoal,
    readTask,
    readTaskAttachment,
    reloadMcpServers,
    renameTask,
    resolvePendingRequest,
    startTask,
    startReview,
    startTurn,
    steerTurn,
    terminateBackgroundTerminal,
    unarchiveTask,
    unsubscribeTask,
    updateGoal,
    uploadFeedback,
  } = createProvider();
  const settings = createSettingsRepository();
  const readDefaultSettings = vi.fn(() => Promise.resolve({}));
  const app = await createCodexlyServer(
    createServerOptions(
      provider,
      {
        ...options,
        settingsRepository: settings.repository,
      },
      readDefaultSettings,
    ),
  );
  closeCallbacks.push(() => app.close());
  return {
    app,
    archiveTask,
    clearGoal,
    compactTask,
    deleteTask,
    emitEvent,
    eventListeners,
    forkTask,
    interruptTurn,
    listBackgroundTerminals,
    listTasks,
    listMcpServers,
    listModels,
    listSkills,
    pinTask,
    queue,
    readGoal,
    readTask,
    readTaskAttachment,
    readDefaultSettings,
    reloadMcpServers,
    renameTask,
    resolvePendingRequest,
    startTask,
    startReview,
    startTurn,
    steerTurn,
    terminateBackgroundTerminal,
    unarchiveTask,
    unsubscribeTask,
    updateGoal,
    ...settings,
    uploadFeedback,
  };
}
