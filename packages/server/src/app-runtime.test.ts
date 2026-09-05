import { describe, expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  encodedProjectRootPath,
  project,
  closeCallbacks,
  createProvider,
  createServerOptions,
  createHarness,
} from "./app-all.test-support.js";

describe("server runtime and core routes", () => {
  it("releases an invisible task through the provider safety boundary", async () => {
    const { app, unsubscribeTask } = await createHarness();

    const response = await app.inject({
      method: "POST",
      payload: {},
      url: "/v1/projects/codexly/tasks/task-1/unsubscribe",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "unsubscribed", taskId: "task-1" });
    expect(unsubscribeTask).toHaveBeenCalledWith("task-1");
  });

  it("lists and idempotently terminates a running background terminal", async () => {
    const { app, listBackgroundTerminals, readTask, terminateBackgroundTerminal } =
      await createHarness();
    listBackgroundTerminals.mockResolvedValue({
      data: [
        {
          command: "pnpm dev",
          cwd: "/workspace/Codexly",
          id: "terminal-1",
          itemId: "command-1",
        },
      ],
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks/task-1/background-terminals",
    });
    const repeatedListResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks/task-1/background-terminals",
    });
    expect(readTask).not.toHaveBeenCalled();
    const terminateRequest = {
      headers: { "idempotency-key": "stop-terminal-1" },
      method: "POST" as const,
      payload: {},
      url: "/v1/projects/codexly/tasks/task-1/background-terminals/terminal-1/terminate",
    };
    const firstTerminateResponse = await app.inject(terminateRequest);
    const repeatedTerminateResponse = await app.inject(terminateRequest);

    expect(listResponse.statusCode).toBe(200);
    expect(repeatedListResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({
      data: [
        {
          command: "pnpm dev",
          cwd: "/workspace/Codexly",
          id: "terminal-1",
          itemId: "command-1",
        },
      ],
    });
    expect(firstTerminateResponse.statusCode).toBe(200);
    expect(repeatedTerminateResponse.json()).toEqual({
      status: "terminated",
      terminalId: "terminal-1",
    });
    expect(terminateBackgroundTerminal).toHaveBeenCalledOnce();
    expect(terminateBackgroundTerminal).toHaveBeenCalledWith("task-1", "terminal-1");
    expect(listBackgroundTerminals).toHaveBeenCalledTimes(2);
  });

  it("serves health, capabilities, and projects", async () => {
    const { app } = await createHarness();

    const healthResponse = await app.inject({ method: "GET", url: "/v1/health" });
    const capabilitiesResponse = await app.inject({ method: "GET", url: "/v1/capabilities" });
    const projectsResponse = await app.inject({ method: "GET", url: "/v1/projects" });

    expect(healthResponse.json()).toEqual({
      status: "ok",
      version: 1,
    });
    expect(capabilitiesResponse.json()).toEqual({
      feedback: { upload: true },
      goals: { clear: true, read: true, update: true },
      provider: "codex",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        start: true,
        steer: true,
      },
    });
    expect(projectsResponse.json()).toEqual({ data: [project], nextCursor: null });
  });

  it("serves the Bing daily wallpaper through the same origin", async () => {
    const originalFetch = globalThis.fetch;
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ images: [{ url: "/th?id=OHR.Workbench.jpg&pid=hp" }] }), {
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(jpeg, {
          headers: { "content-length": String(jpeg.byteLength), "content-type": "image/jpeg" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { app } = await createHarness();
      const response = await app.inject({
        method: "GET",
        url: "/v1/workbench-background/bing?day=2026-08-25",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("image/jpeg");
      expect(response.rawPayload).toEqual(Buffer.from(jpeg));
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("serves application versions and installs an update idempotently", async () => {
    const provider = createProvider().provider;
    const readAppInfo = vi.fn(() =>
      Promise.resolve({
        appVersion: "1.3.0",
        codexVersion: "0.153.4",
        latestVersion: "1.4.0",
        releaseNotes: "### 新增\n\n- 添加在线更新。",
        status: "available" as const,
        updateAvailable: true,
      }),
    );
    const installAppUpdate = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        appVersion: "1.3.0",
        codexVersion: "0.153.4",
        latestVersion: "1.4.0",
        releaseNotes: null,
        status: "restart-required" as const,
        updateAvailable: false,
      };
    });
    const readAppUpdateProgress = vi.fn(() =>
      Promise.resolve({ progress: { percent: 30, phase: "downloading" as const } }),
    );
    const app = await createCodexlyServer(
      createServerOptions(provider, {
        handlerTimeoutMs: 10,
        installAppUpdate,
        readAppInfo,
        readAppUpdateProgress,
      }),
    );
    closeCallbacks.push(() => app.close());

    const infoResponse = await app.inject({ method: "GET", url: "/v1/app-info" });
    const progressResponse = await app.inject({ method: "GET", url: "/v1/app-update/progress" });
    const request = {
      headers: { "idempotency-key": "install-update-1" },
      method: "POST" as const,
      payload: { version: "1.4.0" },
      url: "/v1/app-update",
    };
    const firstResponse = await app.inject(request);
    const repeatedResponse = await app.inject(request);

    expect(infoResponse.statusCode).toBe(200);
    expect(progressResponse.statusCode).toBe(200);
    expect(progressResponse.json()).toEqual({
      progress: { percent: 30, phase: "downloading" },
    });
    expect(infoResponse.json()).toEqual({
      appVersion: "1.3.0",
      codexVersion: "0.153.4",
      latestVersion: "1.4.0",
      releaseNotes: "### 新增\n\n- 添加在线更新。",
      status: "available",
      updateAvailable: true,
    });
    expect(firstResponse.statusCode).toBe(200);
    expect(repeatedResponse.json()).toEqual(firstResponse.json());
    expect(installAppUpdate).toHaveBeenCalledOnce();
    expect(installAppUpdate).toHaveBeenCalledWith("1.4.0");
  });

  it("opens only a registered project through a supported host app idempotently", async () => {
    const provider = createProvider().provider;
    const open = vi.fn(() => Promise.resolve());
    const app = await createCodexlyServer(
      createServerOptions(provider, {
        projectOpenService: {
          getCapabilities: () =>
            Promise.resolve({
              apps: [
                { id: "zed" as const, kind: "editor" as const, name: "Zed" },
                { id: "finder" as const, kind: "file-manager" as const, name: "Finder" },
              ],
              platform: "darwin" as const,
            }),
          open,
        },
      }),
    );
    closeCallbacks.push(() => app.close());

    const capabilitiesResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/open-capabilities",
    });
    const request = {
      headers: { "idempotency-key": "open-project-key" },
      method: "POST" as const,
      payload: { appId: "zed", path: "src/components/app.tsx" },
      url: `/v1/projects/codexly/open?rootPath=${encodedProjectRootPath}`,
    };
    const firstResponse = await app.inject(request);
    const repeatedResponse = await app.inject(request);

    expect(capabilitiesResponse.json()).toEqual({
      apps: [
        { id: "zed", kind: "editor", name: "Zed" },
        { id: "finder", kind: "file-manager", name: "Finder" },
      ],
      platform: "darwin",
    });
    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json()).toEqual({ appId: "zed", path: "src/components/app.tsx" });
    expect(repeatedResponse.json()).toEqual({ appId: "zed", path: "src/components/app.tsx" });
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("/workspace/Codexly", "zed", "src/components/app.tsx");
  });

  it("validates and persists a complete project order idempotently", async () => {
    const provider = createProvider().provider;
    const secondProject = {
      ...project,
      createdAt: "2026-07-23T00:01:00.000Z",
      id: "superwork",
      name: "superwork",
      roots: [{ id: "root-superwork", path: "/workspace/superwork" }],
    };
    let orderedProjects = [project, secondProject];
    const reorder = vi.fn((projectIds: readonly string[]) => {
      orderedProjects = projectIds.map((projectId) => {
        const matchedProject = orderedProjects.find((item) => item.id === projectId);
        if (matchedProject === undefined) {
          throw new Error("Unknown project");
        }
        return matchedProject;
      });
      return Promise.resolve(orderedProjects);
    });
    const app = await createCodexlyServer(
      createServerOptions(provider, {
        projectRepository: {
          list: () => Promise.resolve(orderedProjects),
          read: (projectId: string) =>
            Promise.resolve(orderedProjects.find((item) => item.id === projectId)),
          register: () => Promise.resolve(project),
          reorder,
        },
      }),
    );
    closeCallbacks.push(() => app.close());

    const request = {
      headers: { "idempotency-key": "project-order-key" },
      method: "PUT" as const,
      payload: { projectIds: [secondProject.id, project.id] },
      url: "/v1/projects/order",
    };
    const firstResponse = await app.inject(request);
    const repeatedResponse = await app.inject(request);
    const staleResponse = await app.inject({
      ...request,
      headers: { "idempotency-key": "stale-project-order-key" },
      payload: { projectIds: [project.id] },
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json()).toEqual({
      data: [secondProject, project],
      nextCursor: null,
    });
    expect(repeatedResponse.json()).toEqual(firstResponse.json());
    expect(reorder).toHaveBeenCalledOnce();
    expect(staleResponse.statusCode).toBe(409);
    expect(staleResponse.json()).toMatchObject({ code: "INVALID_REQUEST", retryable: false });
  });
});
