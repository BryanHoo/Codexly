import { vi } from "vitest";
import { createCodeAgentServer } from "./app.js";
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
    uploadFeedback,
  } = createProvider();
  const settings = createSettingsRepository();
  const readDefaultSettings = vi.fn(() => Promise.resolve({}));
  const app = await createCodeAgentServer(
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
    ...settings,
    uploadFeedback,
  };
}
