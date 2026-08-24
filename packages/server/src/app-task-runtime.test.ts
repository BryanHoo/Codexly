import type { AgentRuntimeProvider } from "@code-agent/core";
import type { AgentModelPage } from "@code-agent/protocol";
import { describe, expect, it, vi } from "vitest";
import { createCodeAgentServer } from "./app.js";
import {
  project,
  turnOptions,
  modelPage,
  task,
  snapshot,
  closeCallbacks,
  createProvider,
  createRuntimeConnectionMethods,
  createServerOptions,
  createHarness,
} from "./app-all.test-support.js";

describe("server task runtime", () => {
  it("lists project tasks with validated pagination", async () => {
    const { app, listTasks } = await createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks?archived=true&cursor=cursor&limit=25&searchTerm=%E5%BD%92%E6%A1%A3",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [task], nextCursor: "next" });
    expect(listTasks).toHaveBeenCalledWith({
      archived: true,
      cursor: "cursor",
      limit: 25,
      searchTerm: "归档",
    });
  });

  it("initializes one project runtime for concurrent first requests", async () => {
    const providerHarness = createProvider();
    let releaseProjectRead!: () => void;
    const projectReadGate = new Promise<void>((resolve) => {
      releaseProjectRead = resolve;
    });
    const read = vi.fn(async (projectId: string) => {
      // 同时阻塞首次读取，确保两个请求都经过 Runtime 缓存未命中路径。
      await projectReadGate;
      return projectId === project.id ? project : undefined;
    });
    const subscribeEvents = vi.spyOn(providerHarness.provider, "subscribeEvents");
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, {
        projectRepository: {
          list: () => Promise.resolve([]),
          read,
          register: () => Promise.resolve(project),
        },
      }),
    );
    closeCallbacks.push(() => app.close());
    await app.ready();

    const requests = [
      app.inject({ method: "GET", url: "/v1/projects/code-agent/tasks" }),
      app.inject({ method: "GET", url: "/v1/projects/code-agent/tasks" }),
    ];
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalled();
    });
    releaseProjectRead();

    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(read).toHaveBeenCalledOnce();
    expect(subscribeEvents).toHaveBeenCalledOnce();
    expect(providerHarness.eventListeners.size).toBe(1);
  });

  it("defers registered project runtimes until their first access", async () => {
    const providerHarness = createProvider();
    const forProject = vi.fn(() => providerHarness.provider);
    const runtimeProvider: AgentRuntimeProvider = {
      ...createRuntimeConnectionMethods(),
      forProject,
      forTemporary: () => providerHarness.provider,
      getCapabilities: () => providerHarness.provider.getCapabilities(),
      listModels: () => providerHarness.provider.listModels(),
      readDefaultSettings: () => Promise.resolve({}),
      releaseProject: () => Promise.resolve(),
    };
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, { provider: runtimeProvider }),
    );
    closeCallbacks.push(() => app.close());

    expect(forProject).not.toHaveBeenCalled();
    const projectsResponse = await app.inject({ method: "GET", url: "/v1/projects" });
    expect(projectsResponse.statusCode).toBe(200);
    expect(forProject).not.toHaveBeenCalled();

    const tasksResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks",
    });
    expect(tasksResponse.statusCode).toBe(200);
    expect(forProject).toHaveBeenCalledOnce();
    expect(forProject).toHaveBeenCalledWith(project);
  });

  it("releases an idle project runtime and rebuilds it on the next access", async () => {
    const providerHarness = createProvider();
    const forProject = vi.fn(() => providerHarness.provider);
    const releaseProject = vi.fn(() => Promise.resolve());
    const runtimeProvider: AgentRuntimeProvider = {
      ...createRuntimeConnectionMethods(),
      forProject,
      forTemporary: () => providerHarness.provider,
      getCapabilities: () => providerHarness.provider.getCapabilities(),
      listModels: () => providerHarness.provider.listModels(),
      readDefaultSettings: () => Promise.resolve({}),
      releaseProject,
    };
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, {
        projectRuntimeCleanupIntervalMs: 5,
        projectRuntimeIdleTtlMs: 10,
        provider: runtimeProvider,
      }),
    );
    closeCallbacks.push(() => app.close());

    const firstAccess = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks",
    });
    expect(firstAccess.statusCode).toBe(200);
    expect(forProject).toHaveBeenCalledOnce();

    await vi.waitFor(() => {
      expect(releaseProject).toHaveBeenCalledOnce();
    });

    const secondAccess = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks",
    });
    expect(secondAccess.statusCode).toBe(200);
    expect(forProject).toHaveBeenCalledTimes(2);
  });

  it("waits for an idle release before rebuilding the same project runtime", async () => {
    const providerHarness = createProvider();
    const forProject = vi.fn(() => providerHarness.provider);
    let finishRelease!: () => void;
    const releaseGate = new Promise<void>((resolve) => {
      finishRelease = resolve;
    });
    const releaseProject = vi.fn(() => releaseGate);
    const runtimeProvider: AgentRuntimeProvider = {
      ...createRuntimeConnectionMethods(),
      forProject,
      forTemporary: () => providerHarness.provider,
      getCapabilities: () => providerHarness.provider.getCapabilities(),
      listModels: () => providerHarness.provider.listModels(),
      readDefaultSettings: () => Promise.resolve({}),
      releaseProject,
    };
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, {
        projectRuntimeCleanupIntervalMs: 5,
        projectRuntimeIdleTtlMs: 10,
        provider: runtimeProvider,
      }),
    );
    closeCallbacks.push(() => app.close());

    const firstAccess = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks",
    });
    expect(firstAccess.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(releaseProject).toHaveBeenCalledOnce();
    });

    let secondAccessSettled = false;
    const secondAccess = app
      .inject({ method: "GET", url: "/v1/projects/code-agent/tasks" })
      .finally(() => {
        secondAccessSettled = true;
      });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    const settledBeforeRelease = secondAccessSettled;
    const creationsBeforeRelease = forProject.mock.calls.length;
    finishRelease();
    expect((await secondAccess).statusCode).toBe(200);
    expect(settledBeforeRelease).toBe(false);
    expect(creationsBeforeRelease).toBe(1);
    expect(forProject).toHaveBeenCalledTimes(2);
  });

  it("reads a structured task snapshot", async () => {
    const { app, readTask } = await createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1?cursor=older%2Fpage",
    });
    const body = response.json<{
      checkpoint: { sequence: number; sessionId: unknown };
      snapshot: typeof snapshot;
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.checkpoint.sequence).toBe(0);
    expect(typeof body.checkpoint.sessionId).toBe("string");
    expect(body.snapshot).toEqual({
      ...snapshot,
      settings: { ...turnOptions, sandboxMode: "workspace-write" },
    });
    expect(readTask).toHaveBeenCalledWith("task-1", { cursor: "older/page" });
  });

  it("rejects an empty task snapshot cursor", async () => {
    const { app, readTask } = await createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1?cursor=",
    });

    expect(response.statusCode).toBe(400);
    expect(readTask).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent model catalog reads and reuses the cached catalog", async () => {
    const { app, listModels } = await createHarness();
    let resolveCatalog!: (page: AgentModelPage) => void;
    listModels.mockImplementationOnce(
      () =>
        new Promise<AgentModelPage>((resolve) => {
          resolveCatalog = resolve;
        }),
    );

    const modelsResponse = app.inject({ method: "GET", url: "/v1/models" });
    const snapshotResponse = app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1",
    });
    await vi.waitFor(() => {
      expect(listModels).toHaveBeenCalledOnce();
    });
    resolveCatalog(modelPage);

    expect((await modelsResponse).statusCode).toBe(200);
    expect((await snapshotResponse).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/projects/code-agent/defaults",
        })
      ).statusCode,
    ).toBe(200);
    expect(listModels).toHaveBeenCalledOnce();
  });

  it("expires, bounds, and clears the model catalog cache with the Runtime lifecycle", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const cached = await createHarness({ modelCatalogCacheTtlMs: 100 });
    await cached.app.inject({ method: "GET", url: "/v1/models" });
    await cached.app.inject({ method: "GET", url: "/v1/models" });
    expect(cached.listModels).toHaveBeenCalledOnce();

    now.mockReturnValue(1_101);
    await cached.app.inject({ method: "GET", url: "/v1/models" });
    expect(cached.listModels).toHaveBeenCalledTimes(2);

    const bounded = await createHarness({ modelCatalogCacheMaxBytes: 1 });
    await bounded.app.inject({ method: "GET", url: "/v1/models" });
    await bounded.app.inject({ method: "GET", url: "/v1/models" });
    expect(bounded.listModels).toHaveBeenCalledTimes(2);

    const restartedProvider = createProvider();
    const firstRuntime = await createCodeAgentServer(
      createServerOptions(restartedProvider.provider),
    );
    await firstRuntime.inject({ method: "GET", url: "/v1/models" });
    await firstRuntime.close();
    const secondRuntime = await createCodeAgentServer(
      createServerOptions(restartedProvider.provider),
    );
    closeCallbacks.push(() => secondRuntime.close());
    await secondRuntime.inject({ method: "GET", url: "/v1/models" });
    expect(restartedProvider.listModels).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });
});
