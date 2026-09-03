import type {
  AgentProvider,
  AgentQueueRecord,
  AgentRuntimeProvider,
  RegisterProjectInput,
} from "@codexly/core";
import type {
  AgentGlobalSettings,
  AgentProviderConnectionRecord,
  AgentProviderConnectionStatus,
  AgentProjectDefaults,
  AgentTaskSettings,
  Project,
} from "@codexly/protocol";
import { expect, vi } from "vitest";
import { project, temporaryProject } from "./app.test-support.js";

export function createQueueRepository() {
  const records = new Map<string, AgentQueueRecord[]>();
  const key = (projectId: string, taskId: string) => `${projectId}\u0000${taskId}`;
  return {
    addQueue: vi.fn((record: AgentQueueRecord) => {
      const queue = records.get(key(record.projectId, record.taskId)) ?? [];
      queue.push(record);
      records.set(key(record.projectId, record.taskId), queue);
      return Promise.resolve(record);
    }),
    deleteQueue: vi.fn((projectId: string, taskId: string, queuedSubmissionId: string) => {
      const queue = records.get(key(projectId, taskId)) ?? [];
      const index = queue.findIndex((record) => record.id === queuedSubmissionId);
      if (index < 0) return Promise.resolve(false);
      queue.splice(index, 1);
      return Promise.resolve(true);
    }),
    listQueue: vi.fn((projectId: string, taskId: string) =>
      Promise.resolve([...(records.get(key(projectId, taskId)) ?? [])]),
    ),
    reorderQueue: vi.fn(
      (projectId: string, taskId: string, queuedSubmissionIds: readonly string[]) => {
        const queue = records.get(key(projectId, taskId)) ?? [];
        const byId = new Map(queue.map((record) => [record.id, record]));
        records.set(
          key(projectId, taskId),
          queuedSubmissionIds.flatMap((id) => {
            const record = byId.get(id);
            return record === undefined ? [] : [record];
          }),
        );
        return Promise.resolve();
      },
    ),
    updateQueue: vi.fn(
      (
        projectId: string,
        taskId: string,
        queuedSubmissionId: string,
        input: AgentQueueRecord["input"],
        status: AgentQueueRecord["status"],
      ) => {
        const queue = records.get(key(projectId, taskId)) ?? [];
        const index = queue.findIndex((record) => record.id === queuedSubmissionId);
        const current = queue[index];
        if (current === undefined) return Promise.resolve(undefined);
        const updated = { ...current, input, status };
        queue[index] = updated;
        return Promise.resolve(updated);
      },
    ),
  };
}

// 组合设置仓库与 Runtime 选项，保持各路由测试的启动方式一致。
export function createSettingsRepository() {
  let providerConnection: AgentProviderConnectionRecord | undefined;
  const readGlobalSettings = vi.fn(() =>
    Promise.resolve<AgentGlobalSettings | undefined>(undefined),
  );
  const readProjectDefaults = vi.fn(() =>
    Promise.resolve<AgentProjectDefaults | undefined>(undefined),
  );
  const readTaskSettings = vi.fn(() => Promise.resolve<AgentTaskSettings | undefined>(undefined));
  const writeProjectDefaults = vi.fn((_projectId: string, settings: AgentProjectDefaults) =>
    Promise.resolve(settings),
  );
  const writeGlobalSettings = vi.fn((_settings: AgentGlobalSettings) => Promise.resolve(_settings));
  const writeTaskSettings = vi.fn(
    (_projectId: string, _taskId: string, settings: AgentTaskSettings) => Promise.resolve(settings),
  );
  const readProviderConnection = vi.fn(() => Promise.resolve(providerConnection));
  const writeProviderConnection = vi.fn((record: AgentProviderConnectionRecord) => {
    providerConnection = record;
    return Promise.resolve(record);
  });
  return {
    readProviderConnection,
    readGlobalSettings,
    readProjectDefaults,
    readTaskSettings,
    repository: {
      readProviderConnection,
      readGlobalSettings,
      readProjectDefaults,
      readTaskSettings,
      writeGlobalSettings,
      writeProviderConnection,
      writeProjectDefaults,
      writeTaskSettings,
    },
    writeGlobalSettings,
    writeProviderConnection,
    writeProjectDefaults,
    writeTaskSettings,
  };
}

export function createRuntimeConnectionMethods(): Pick<
  AgentRuntimeProvider,
  | "cancelProviderLogin"
  | "configureCustomProvider"
  | "logoutProvider"
  | "readProviderConnection"
  | "startOfficialProviderLogin"
> {
  const status: AgentProviderConnectionStatus = {
    account: null,
    customBaseUrl: null,
    mode: "official",
    pendingLogin: null,
    state: "disconnected",
  };
  return {
    cancelProviderLogin: vi.fn(() => Promise.resolve({ status })),
    configureCustomProvider: vi.fn(() => Promise.reject(new Error("Not configured"))),
    logoutProvider: vi.fn(() => Promise.resolve({ status })),
    readProviderConnection: vi.fn(() => Promise.resolve(status)),
    startOfficialProviderLogin: vi.fn(() => Promise.reject(new Error("Not configured"))),
  };
}

export function createServerOptions(
  provider: AgentProvider,
  overrides: Record<string, unknown> = {},
  readDefaultSettings = vi.fn(() => Promise.resolve({})),
) {
  const orderedProjects: Project[] = [project];
  const runtimeProvider: AgentRuntimeProvider = {
    ...createRuntimeConnectionMethods(),
    forProject: () => provider,
    forTemporary: () => provider,
    getCapabilities: () => provider.getCapabilities(),
    listModels: () => provider.listModels(),
    readDefaultSettings,
    releaseProject: () => Promise.resolve(),
  };
  const stateRepository = createSettingsRepository().repository;
  const queueRepository = createQueueRepository();
  return {
    handlerTimeoutMs: 0,
    installAppUpdate: vi.fn(() => Promise.reject(new Error("No update available"))),
    loggerEnabled: false,
    projectRepository: {
      list: vi.fn(() => Promise.resolve(orderedProjects)),
      read: vi.fn((projectId: string) =>
        Promise.resolve(
          projectId === project.id
            ? project
            : projectId === temporaryProject.id
              ? temporaryProject
              : undefined,
        ),
      ),
      register: vi.fn((input: RegisterProjectInput) => {
        expect(input.idempotencyKey).toBe("add-project");
        return Promise.resolve(project);
      }),
      remove: vi.fn((projectId: string) => {
        const projectIndex = orderedProjects.findIndex((item) => item.id === projectId);
        if (projectIndex < 0) {
          return Promise.resolve(false);
        }
        orderedProjects.splice(projectIndex, 1);
        return Promise.resolve(true);
      }),
      rename: vi.fn((projectId: string, name: string) => {
        const projectIndex = orderedProjects.findIndex((item) => item.id === projectId);
        const currentProject = orderedProjects[projectIndex];
        if (currentProject === undefined) {
          return Promise.resolve(undefined);
        }
        const renamedProject = { ...currentProject, name };
        orderedProjects[projectIndex] = renamedProject;
        return Promise.resolve(renamedProject);
      }),
      reorder: vi.fn((projectIds: readonly string[]) => {
        const reordered = projectIds.map((projectId) =>
          orderedProjects.find((currentProject) => currentProject.id === projectId),
        );
        return Promise.resolve(reordered.filter((item) => item !== undefined));
      }),
    },
    providerConnectionRepository: stateRepository,
    petProvider: {
      ensurePetAsset: () => Promise.reject(new Error("Pet downloads are unavailable")),
      listPets: () => Promise.resolve([]),
      openPetAsset: () => Promise.resolve(undefined),
    },
    queueRepository,
    provider: runtimeProvider,
    readAppInfo: vi.fn(() =>
      Promise.resolve({
        appVersion: "1.3.0",
        codexVersion: "0.152.1",
        latestVersion: "1.3.0",
        releaseNotes: null,
        status: "current" as const,
        updateAvailable: false,
      }),
    ),
    readAppUpdateProgress: vi.fn(() => Promise.resolve({ progress: null })),
    settingsRepository: stateRepository,
    standaloneCwd: temporaryProject.rootPath,
    ...overrides,
  };
}
