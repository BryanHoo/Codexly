import { rm } from "node:fs/promises";
import type { Project } from "@codexly/protocol";
import { afterEach, beforeEach, vi, type Mock } from "vitest";
import type { CliDependencies, RunCliOptions } from "./cli-command.js";
import { STARTUP_UPDATE_APPLIED_ENV } from "./cli-startup-update.js";

// 集中维护拆分测试共享的样本、mock 与生命周期钩子。
export const temporaryDirectories: string[] = [];

beforeEach(() => {
  // CLI 测试默认模拟首次启动，不能继承调用测试进程时残留的重启标记。
  vi.stubEnv(STARTUP_UPDATE_APPLIED_ENV, "0");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

type ProjectRepositoryHarness = Omit<
  ReturnType<CliDependencies["createProjectRepository"]>,
  "migrateLegacyProjects" | "synchronize"
> &
  Readonly<{
    migrateLegacyProjects: Mock<
      ReturnType<CliDependencies["createProjectRepository"]>["migrateLegacyProjects"]
    >;
    synchronize: Mock<ReturnType<CliDependencies["createProjectRepository"]>["synchronize"]>;
  }>;

type StateRepositoryHarness = Awaited<ReturnType<CliDependencies["createStateRepository"]>> &
  Readonly<{
    diagnose: Mock<Awaited<ReturnType<CliDependencies["createStateRepository"]>>["diagnose"]>;
    readProjectSourceMigration: Mock<
      Awaited<ReturnType<CliDependencies["createStateRepository"]>>["readProjectSourceMigration"]
    >;
  }>;

type CliHarness = Readonly<{
  client: Awaited<ReturnType<CliDependencies["startCodexAppServer"]>>["client"];
  close: Mock<() => Promise<void>>;
  databaseClose: Mock<() => Promise<void>>;
  dependencies: CliDependencies;
  lifecycle: string[];
  options: RunCliOptions;
  project: Project;
  projectRepository: ProjectRepositoryHarness;
  provider: ReturnType<Awaited<ReturnType<CliDependencies["createRuntimeProvider"]>>["forProject"]>;
  runtimeProvider: Awaited<ReturnType<CliDependencies["createRuntimeProvider"]>>;
  serverClose: Mock<() => Promise<void>>;
  serverListen: Mock<(options: { host: string; port: number }) => Promise<string>>;
  stateRepository: StateRepositoryHarness;
  stderr: string[];
  stdout: string[];
}>;

export function createHarness(overrides: Partial<CliDependencies> = {}): CliHarness {
  const lifecycle: string[] = [];
  let resolveExit!: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveExit = resolve;
  });
  const close = vi.fn(() => {
    lifecycle.push("runtime.close");
    resolveExit({ code: 0, signal: null });
    return Promise.resolve();
  });
  const serverClose = vi.fn(() => {
    lifecycle.push("server.close");
    return Promise.resolve();
  });
  const databaseClose = vi.fn(() => {
    lifecycle.push("database.close");
    return Promise.resolve();
  });
  const serverListen = vi.fn(() => {
    lifecycle.push("server.listen");
    return Promise.resolve("http://127.0.0.1:3210");
  });
  const client = {
    notify: vi.fn(),
    onNotification: vi.fn(() => () => undefined),
    onServerRequest: vi.fn(() => () => undefined),
    rejectServerRequest: vi.fn(() => Promise.resolve()),
    request: vi.fn(),
    respondToServerRequest: vi.fn(),
  };
  const provider = {
    archiveTask: vi.fn(),
    clearGoal: vi.fn(),
    compactTask: vi.fn(),
    deleteTask: vi.fn(),
    forkTask: vi.fn(),
    getCapabilities: vi.fn(),
    interruptTurn: vi.fn(),
    listBackgroundTerminals: vi.fn(),
    listMcpServers: vi.fn(),
    listModels: vi.fn(),
    listSkills: vi.fn(),
    listTasks: vi.fn(),
    pinTask: vi.fn(),
    readGoal: vi.fn(() => Promise.resolve(null)),
    readSandboxMode: vi.fn(() => Promise.resolve("workspace-write" as const)),
    readTask: vi.fn(),
    readTaskAttachment: vi.fn(() => Promise.resolve(undefined)),
    reloadMcpServers: vi.fn(),
    renameTask: vi.fn(),
    resolvePendingRequest: vi.fn(),
    startTask: vi.fn(),
    startReview: vi.fn(),
    startTurn: vi.fn(),
    steerTurn: vi.fn(),
    subscribeEvents: vi.fn(() => () => undefined),
    terminateBackgroundTerminal: vi.fn(),
    unarchiveTask: vi.fn(),
    unsubscribeTask: vi.fn(),
    updateGoal: vi.fn(),
    uploadFeedback: vi.fn(),
  };
  const runtimeProvider = {
    cancelProviderLogin: vi.fn(() =>
      Promise.resolve({
        status: {
          account: null,
          customBaseUrl: null,
          mode: "official" as const,
          pendingLogin: null,
          state: "disconnected" as const,
        },
      }),
    ),
    configureCustomProvider: vi.fn(() => Promise.reject(new Error("Not configured"))),
    forProject: vi.fn(() => provider),
    forTemporary: vi.fn(() => provider),
    getCapabilities: provider.getCapabilities,
    listConfiguredMcpServers: vi.fn(() => Promise.resolve({ data: [] })),
    listInstalledSkills: vi.fn(() => Promise.resolve({ data: [], nextCursor: null })),
    listModels: provider.listModels,
    logoutProvider: vi.fn(() =>
      Promise.resolve({
        status: {
          account: null,
          customBaseUrl: null,
          mode: "official" as const,
          pendingLogin: null,
          state: "disconnected" as const,
        },
      }),
    ),
    readDefaultSettings: vi.fn(() => Promise.resolve({})),
    readProviderConnection: vi.fn(() =>
      Promise.resolve({
        account: null,
        customBaseUrl: null,
        mode: "official" as const,
        pendingLogin: null,
        state: "disconnected" as const,
      }),
    ),
    releaseProject: vi.fn(() => Promise.resolve()),
    setMcpServerEnabled: vi.fn((_name: string, enabled: boolean) => Promise.resolve({ enabled })),
    setSkillEnabled: vi.fn((_path: string, enabled: boolean) =>
      Promise.resolve({ effectiveEnabled: enabled }),
    ),
    startOfficialProviderLogin: vi.fn(() => Promise.reject(new Error("Not configured"))),
  };
  const project = {
    createdAt: "2026-07-23T00:00:00.000Z",
    id: "project",
    name: "project",
    roots: [{ id: "root-project", path: "/workspace/project" }],
  };
  const projectRepository = {
    list: vi.fn(() => Promise.resolve([project])),
    migrateLegacyProjects: vi.fn(() => {
      lifecycle.push("projects.migrate");
      return Promise.resolve();
    }),
    read: vi.fn(() => Promise.resolve(project)),
    register: vi.fn(),
    remove: vi.fn(() => Promise.resolve(false)),
    rename: vi.fn(() => Promise.resolve(undefined)),
    reorder: vi.fn(() => Promise.resolve([project])),
    synchronize: vi.fn(() => {
      lifecycle.push("projects.synchronize");
      return Promise.resolve([project]);
    }),
  };
  const stateRepository = {
    addQueue: vi.fn((record) => Promise.resolve(record)),
    close: databaseClose,
    completeProjectSourceMigration: vi.fn(() => {
      lifecycle.push("projects.migration.complete");
      return Promise.resolve();
    }),
    diagnose: vi.fn(() =>
      Promise.resolve({
        busyTimeout: 5_000,
        foreignKeys: true,
        integrityCheck: "ok",
        journalMode: "wal",
        migrationVersion: 4,
        synchronous: "normal",
        writable: true,
      }),
    ),
    deleteProject: vi.fn(() => Promise.resolve(false)),
    deleteQueue: vi.fn(() => Promise.resolve(false)),
    deleteScheduledTaskAttachments: vi.fn(() => Promise.resolve()),
    list: vi.fn(() => Promise.resolve([])),
    listQueue: vi.fn(() => Promise.resolve([])),
    listScheduledTaskAttachments: vi.fn(() => Promise.resolve([])),
    listScheduledTasks: vi.fn(() => Promise.resolve([])),
    migrateProject: vi.fn((_legacyProjectId, project) => Promise.resolve(project)),
    readGlobalSettings: vi.fn(() => Promise.resolve(undefined)),
    readProviderConnection: vi.fn(() => Promise.resolve(undefined)),
    readScheduledTaskAttachment: vi.fn(() => Promise.resolve(undefined)),
    readProjectDefaults: vi.fn(() => Promise.resolve(undefined)),
    readProjectSourceMigration: vi.fn(() =>
      Promise.resolve({ completed: true, recoverUnassigned: false }),
    ),
    readTaskSettings: vi.fn(() => Promise.resolve(undefined)),
    read: vi.fn(() => Promise.resolve(undefined)),
    replaceProjects: vi.fn((projects) => Promise.resolve(projects)),
    replaceScheduledTaskAttachments: vi.fn(() => Promise.resolve()),
    replaceScheduledTasks: vi.fn((tasks) => Promise.resolve(tasks)),
    reorderQueue: vi.fn(() => Promise.resolve()),
    setProjectOrder: vi.fn(() => Promise.resolve([])),
    upsertProject: vi.fn((project) => Promise.resolve(project)),
    updateQueue: vi.fn(() => Promise.resolve(undefined)),
    writeGlobalSettings: vi.fn((settings) => Promise.resolve(settings)),
    writeProviderConnection: vi.fn((record) => Promise.resolve(record)),
    writeProjectDefaults: vi.fn((_projectId, settings) => Promise.resolve(settings)),
    writeTaskSettings: vi.fn((_projectId, _taskId, settings) => Promise.resolve(settings)),
  };
  const dependencies: CliDependencies = {
    appVersion: "1.2.3",
    checkAppUpdate: vi.fn(() =>
      Promise.resolve({ latestVersion: "1.2.3", status: "current" as const }),
    ),
    checkCodexVersion: vi.fn(() =>
      Promise.resolve({ raw: "codex-cli 0.153.4", version: "0.153.4" }),
    ),
    confirmAppUpdate: vi.fn(() => Promise.resolve(false)),
    createProjectRepository: vi.fn(() => {
      lifecycle.push("projects.create");
      return projectRepository;
    }),
    createPetProvider: vi.fn(() => ({
      ensurePetAsset: vi.fn(() => Promise.reject(new Error("Pet downloads are unavailable"))),
      listPets: vi.fn(() => Promise.resolve([])),
      openPetAsset: vi.fn(() => Promise.resolve(undefined)),
    })),
    createStateRepository: vi.fn(() => Promise.resolve(stateRepository)),
    createRuntimeProvider: vi.fn(() => {
      lifecycle.push("provider.create");
      return runtimeProvider;
    }),
    generateLanPairingCode: vi.fn(() => "fixed-test-pairing-code"),
    listLanAccessUrls: vi.fn((port: number) => [`http://192.168.1.20:${String(port)}`]),
    createServer: vi.fn(() => {
      lifecycle.push("server.create");
      return Promise.resolve({ close: serverClose, listen: serverListen });
    }),
    locateCodexBinary: vi.fn(() =>
      Promise.resolve({ path: "/fake/codex", source: "explicit" as const }),
    ),
    nodeVersion: "22.14.0",
    openBrowser: vi.fn(() => {
      lifecycle.push("browser.open");
      return Promise.resolve();
    }),
    installAppUpdate: vi.fn(() => Promise.resolve()),
    restartAfterUpdate: vi.fn(() => Promise.resolve(0)),
    startCodexAppServer: vi.fn(() =>
      Promise.resolve({
        client,
        close,
        pid: 4321,
        version: { raw: "codex-cli 0.153.4", version: "0.153.4" },
        waitForExit: () => exit,
      }),
    ),
    webRoot: "/package/dist/web",
    ...overrides,
  };
  const stderr: string[] = [];
  const stdout: string[] = [];

  return {
    close,
    client,
    databaseClose,
    dependencies,
    lifecycle,
    options: {
      dependencies,
      stderr: (message: string) => {
        stderr.push(message);
      },
      stdout: (message: string) => {
        stdout.push(message);
      },
    },
    project,
    projectRepository,
    stateRepository,
    provider,
    runtimeProvider,
    stderr,
    serverClose,
    serverListen,
    stdout,
  };
}
