import type { AgentRuntimeProvider } from "@codexly/core";
import { describe, expect, it, vi } from "vitest";

import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createRuntimeConnectionMethods,
  createSettingsRepository,
  project,
  snapshot,
  temporaryProject,
} from "./app-all.test-support.js";

describe("server task idempotency isolation", () => {
  it("isolates idempotent task command results by project", async () => {
    const primary = createProvider();
    const secondary = createProvider();
    const otherProject = {
      ...project,
      id: "other-project",
      name: "Other Project",
      rootPath: "/workspace/OtherProject",
    };
    secondary.readTask.mockResolvedValue({ ...snapshot, projectId: otherProject.id });
    secondary.startReview.mockResolvedValue({
      completedAt: null,
      error: null,
      id: "other-review-turn",
      items: [],
      startedAt: "2026-07-26T00:00:00.000Z",
      status: "running",
    });
    const runtimeProvider: AgentRuntimeProvider = {
      ...createRuntimeConnectionMethods(),
      forProject: (activeProject) =>
        activeProject.id === otherProject.id ? secondary.provider : primary.provider,
      forTemporary: () => primary.provider,
      getCapabilities: () => primary.provider.getCapabilities(),
      listModels: () => primary.provider.listModels(),
      readDefaultSettings: () => Promise.resolve({}),
      releaseProject: () => Promise.resolve(),
    };
    const stateRepository = createSettingsRepository().repository;
    const app = await createCodexlyServer({
      installAppUpdate: vi.fn(() => Promise.reject(new Error("No update available"))),
      projectRepository: {
        list: () => Promise.resolve([project, otherProject]),
        read: (projectId) =>
          Promise.resolve([project, otherProject].find((item) => item.id === projectId)),
        register: () => Promise.resolve(project),
        remove: () => Promise.resolve(false),
        rename: () => Promise.resolve(undefined),
        reorder: () => Promise.resolve([project, otherProject]),
      },
      providerConnectionRepository: stateRepository,
      petProvider: {
        ensurePetAsset: () => Promise.reject(new Error("Pet downloads are unavailable")),
        listPets: () => Promise.resolve([]),
        openPetAsset: () => Promise.resolve(undefined),
      },
      provider: runtimeProvider,
      standaloneCwd: temporaryProject.rootPath,
      readAppInfo: vi.fn(() =>
        Promise.resolve({
          appVersion: "1.3.0",
          codexVersion: "0.153.4",
          latestVersion: "1.3.0",
          releaseNotes: null,
          status: "current" as const,
          updateAvailable: false,
        }),
      ),
      readAppUpdateProgress: vi.fn(() => Promise.resolve({ progress: null })),
      settingsRepository: stateRepository,
    });
    closeCallbacks.push(() => app.close());
    const request = {
      headers: { "idempotency-key": "shared-review-key" },
      method: "POST" as const,
      payload: { target: { type: "uncommitted_changes" } },
    };

    const first = await app.inject({
      ...request,
      url: "/v1/projects/codexly/tasks/task-1/review",
    });
    const second = await app.inject({
      ...request,
      url: "/v1/projects/other-project/tasks/task-1/review",
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ turn: { id: "other-review-turn" } });
    expect(primary.startReview).toHaveBeenCalledTimes(1);
    expect(secondary.startReview).toHaveBeenCalledTimes(1);
  });
});
