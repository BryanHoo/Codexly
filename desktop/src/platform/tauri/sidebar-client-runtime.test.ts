import { describe, expect, it, vi } from "vitest";

import { TauriSidebarClient, type InvokeImplementation } from "./sidebar-client.js";

describe("TauriSidebarClient runtime metadata", () => {
  it("reads static capabilities without starting an unselected Codex runtime", async () => {
    const ensureRuntime = vi.fn(async () => undefined);
    const client = new TauriSidebarClient({ ensureRuntime, invoke: vi.fn() as InvokeImplementation });
    await expect(client.getCapabilities()).resolves.toMatchObject({ provider: "codex" });
    expect(ensureRuntime).not.toHaveBeenCalled();
  });
  it("reads app metadata and shared preferences without activating Codex", async () => {
    const ensureRuntime = vi.fn(async () => undefined);
    const invoke = vi.fn(async () => ({})) as InvokeImplementation;
    const client = new TauriSidebarClient({ ensureRuntime, invoke });
    await client.getAppInfo();
    await client.getProjectOpenCapabilities();
    await client.getGlobalSettings({ engine: "claude" });
    expect(ensureRuntime).not.toHaveBeenCalled();
  });
  it("browses files, reads Git and uploads attachments without activating Codex", async () => {
    const ensureRuntime = vi.fn(async () => undefined);
    const invoke = vi.fn(async () => ({})) as InvokeImplementation;
    const client = new TauriSidebarClient({ ensureRuntime, invoke });
    const signal = new AbortController().signal;
    await client.listProjectFiles("project", "/workspace", null, { signal });
    await client.getProjectGitStatus("project", { rootPath: "/workspace" }, { signal });
    await client.searchProjectFiles("project", "/workspace", "readme", "search", { signal });
    await client.readProjectTextFile("project", "/workspace", "README.md");
    await client.readProjectTextFileRevision("project", "/workspace", "README.md");
    await client.uploadAttachment("project", { kind: "file", name: "readme.txt", content: new Blob(["test"]) });
    expect(invoke).toHaveBeenCalledTimes(6);
    expect(ensureRuntime).not.toHaveBeenCalled();
  });
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
      codexVersion: "0.163.0",
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
