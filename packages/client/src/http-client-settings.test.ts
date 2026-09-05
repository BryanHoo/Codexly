import { describe, expect, it, vi } from "vitest";
import { CodexlyClient, CodexlyResponseError } from "./http-client.js";
import {
  task,
  taskSettings,
  projectDefaults,
  globalSettings,
  jsonResponse,
} from "./http-client.test-support.js";

describe("CodexlyClient settings and app routes", () => {
  it("uses the configured base URL for all read methods", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "ok", version: 1 }))
      .mockResolvedValueOnce(
        jsonResponse({
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
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], nextCursor: null }))
      .mockResolvedValueOnce(
        jsonResponse({
          checkpoint: { sequence: 0, sessionId: "runtime-1" },
          snapshot: {
            ...task,
            contextUsage: null,
            goal: null,
            pendingRequests: [],
            plan: null,
            settings: taskSettings,
            status: "idle",
            turns: [],
            turnsNextCursor: null,
          },
        }),
      );
    const client = new CodexlyClient({ baseUrl: "http://127.0.0.1:3210/", fetch: fetchMock });

    await client.getHealth();
    await client.getCapabilities();
    await client.listProjects();
    await client.readTask("codexly", "task-1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "http://127.0.0.1:3210/v1/health",
      "http://127.0.0.1:3210/v1/capabilities",
      "http://127.0.0.1:3210/v1/projects",
      "http://127.0.0.1:3210/v1/projects/codexly/tasks/task-1",
    ]);
  });

  it("rejects non-success HTTP responses", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ message: "failed" }, { status: 500 }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(client.getHealth()).rejects.toMatchObject({
      message: "failed",
      name: "CodexlyHttpError",
    });
  });

  it("reads and atomically updates project defaults and task settings", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ settings: projectDefaults }))
      .mockResolvedValueOnce(jsonResponse({ settings: projectDefaults }))
      .mockResolvedValueOnce(jsonResponse({ settings: taskSettings }))
      .mockResolvedValueOnce(jsonResponse({ settings: taskSettings }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(client.getProjectDefaults("project one")).resolves.toEqual({
      settings: projectDefaults,
    });
    await expect(
      client.updateProjectDefaults("project one", projectDefaults, {
        idempotencyKey: "project-defaults-key",
      }),
    ).resolves.toEqual({ settings: projectDefaults });
    await expect(client.getTaskSettings("project one", "task/1")).resolves.toEqual({
      settings: taskSettings,
    });
    await expect(
      client.updateTaskSettings("project one", "task/1", taskSettings, {
        idempotencyKey: "task-settings-key",
      }),
    ).resolves.toEqual({ settings: taskSettings });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/v1/projects/project%20one/defaults",
      "/v1/projects/project%20one/defaults",
      "/v1/projects/project%20one/tasks/task%2F1/settings",
      "/v1/projects/project%20one/tasks/task%2F1/settings",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify(projectDefaults),
      method: "PUT",
    });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "project-defaults-key",
    );
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      body: JSON.stringify(taskSettings),
      method: "PUT",
    });
  });

  it("reads and atomically updates global settings", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ settings: globalSettings }))
      .mockResolvedValueOnce(jsonResponse({ settings: globalSettings }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(client.getGlobalSettings()).resolves.toEqual({ settings: globalSettings });
    await expect(
      client.updateGlobalSettings(globalSettings, { idempotencyKey: "global-settings-key" }),
    ).resolves.toEqual({ settings: globalSettings });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/v1/settings", "/v1/settings"]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify(globalSettings),
      method: "PUT",
    });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "global-settings-key",
    );
  });

  it("reads application versions and installs a validated update", async () => {
    const available = {
      appVersion: "1.3.0",
      codexVersion: "0.153.4",
      latestVersion: "1.4.0",
      releaseNotes: "### 新增\n\n- 添加在线更新。",
      status: "available" as const,
      updateAvailable: true,
    };
    const installed = {
      appVersion: available.appVersion,
      codexVersion: available.codexVersion,
      latestVersion: available.latestVersion,
      releaseNotes: null,
      status: "restart-required" as const,
      updateAvailable: false as const,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(available))
      .mockResolvedValueOnce(jsonResponse({ progress: { percent: 30, phase: "downloading" } }))
      .mockResolvedValueOnce(jsonResponse(installed));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(client.getAppInfo()).resolves.toEqual(available);
    await expect(client.getAppUpdateProgress()).resolves.toEqual({
      progress: { percent: 30, phase: "downloading" },
    });
    await expect(
      client.installAppUpdate("1.4.0", { idempotencyKey: "app-update-key" }),
    ).resolves.toEqual(installed);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/v1/app-info",
      "/v1/app-update/progress",
      "/v1/app-update",
    ]);
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify({ version: "1.4.0" }),
      method: "POST",
    });
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("idempotency-key")).toBe(
      "app-update-key",
    );
  });

  it("rejects malformed application information", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        appVersion: "1.3.0",
        codexVersion: "0.153.4",
        latestVersion: "latest",
        releaseNotes: null,
        status: "available",
        updateAvailable: true,
      }),
    );
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(client.getAppInfo()).rejects.toBeInstanceOf(CodexlyResponseError);
  });

  it("rejects malformed settings responses", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      jsonResponse({ settings: { ...taskSettings, approvalPolicy: "allow_for_session" } }),
    );
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(client.getTaskSettings("codexly", "task-1")).rejects.toBeInstanceOf(
      CodexlyResponseError,
    );
  });
});
