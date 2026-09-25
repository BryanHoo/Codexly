import { describe, expect, it, vi } from "vitest";

import { TauriSidebarClient, type InvokeImplementation } from "./sidebar-client.js";

describe("TauriSidebarClient runtime metadata", () => {
  it("routes native Codex feedback and advertises the capability", async () => {
    const invoke = vi.fn(async () => ({ status: "sent", taskId: "thread-a" }));
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await expect(
      client.uploadFeedback("project-a", "thread-a", {
        classification: "bug",
        includeLogs: true,
        reason: "时间线未刷新",
      }),
    ).resolves.toEqual({ status: "sent", taskId: "thread-a" });
    await expect(client.getCapabilities()).resolves.toMatchObject({ feedback: { upload: true } });
    expect(invoke).toHaveBeenCalledWith("upload_feedback", {
      input: { classification: "bug", includeLogs: true, reason: "时间线未刷新" },
      projectId: "project-a",
      taskId: "thread-a",
    });
  });

  it("reads application and verified Codex versions from Rust", async () => {
    const appInfo = {
      appVersion: "0.1.0",
      changelogUrl: "https://github.com/BryanHoo/CodeAgent/blob/main/CHANGELOG.md",
      codexVersion: "0.156.0",
      latestVersion: null,
      releaseNotes: "## [0.1.0] - 2026-08-31",
      releaseNotesVersion: "0.1.0",
      repositoryUrl: "https://github.com/BryanHoo/CodeAgent",
      status: "current" as const,
      updateAvailable: false,
    };
    const invoke = vi.fn(async () => appInfo);
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await expect(client.getAppInfo()).resolves.toEqual(appInfo);
    expect(invoke).toHaveBeenCalledWith("get_app_info");
  });
});
