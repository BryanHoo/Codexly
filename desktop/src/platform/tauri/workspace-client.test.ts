import { describe, expect, it, vi } from "vitest";

import { NativeCommandError, type InvokeImplementation } from "./native-client.js";
import { TauriWorkspaceClient } from "./workspace-client.js";

describe("TauriWorkspaceClient", () => {
  it("opens temporary task paths with task-scoped workspace validation", async () => {
    const invoke = vi.fn(async () => ({}));
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await client.getProjectOpenCapabilities();
    await client.openProject("temporary", undefined, {
      appId: "explorer",
      fallbackToExistingAncestor: true,
      path: "C:\\CodeAgent\\temporary-workspaces\\task-a",
      taskId: "task-a",
    });

    expect(invoke.mock.calls).toEqual([
      ["get_project_open_capabilities"],
      [
        "open_project",
        {
          input: {
            appId: "explorer",
            fallbackToExistingAncestor: true,
            path: "C:\\CodeAgent\\temporary-workspaces\\task-a",
            taskId: "task-a",
          },
          projectId: "temporary",
          rootPath: null,
        },
      ],
    ]);
  });

  it("uploads browser attachments through the raw Tauri IPC body", async () => {
    const invoke = vi.fn(async () => ({
      attachment: {
        id: "/cache/notes.txt",
        kind: "file",
        mediaType: "text/plain",
        name: "笔记.txt",
        size: 6,
      },
    }));
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const file = new File(["内容"], "笔记.txt", { type: "text/plain" });

    await client.uploadAttachment("project-a", {
      content: file,
      kind: "file",
      name: file.name,
    });

    const [command, body, options] = (invoke.mock.calls as unknown[][])[0] ?? [];
    expect(command).toBe("upload_attachment");
    expect(body).toBeInstanceOf(Uint8Array);
    expect([...((body as Uint8Array | undefined) ?? [])]).toEqual([
      0xe5, 0x86, 0x85, 0xe5, 0xae, 0xb9,
    ]);
    expect(options).toEqual({
      headers: {
        "x-codeagent-kind": "file",
        "x-codeagent-name": "56yU6K6wLnR4dA==",
        "x-codeagent-project-id": "project-a",
      },
    });
  });

  it("routes guarded file operations through Tauri commands", async () => {
    const invoke = vi.fn(async () => ({}));
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await client.listProjectFiles("project-a", "/work/a", "src");
    await client.searchProjectFiles("project-a", "/work/a", "main", "search-a");
    await client.renameProjectFile("project-a", "/work/a", {
      name: "lib.rs",
      path: "src/main.rs",
    });
    await client.deleteProjectFile("project-a", "/work/a", { path: "src/old.rs" });
    await client.readProjectSourceFile("project-a", "/work/a", "src/lib.rs", 10, {
      taskId: "task-a",
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "list_project_files", {
      directoryPath: "src",
      projectId: "project-a",
      rootPath: "/work/a",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "search_project_files", {
      projectId: "project-a",
      query: "main",
      rootPath: "/work/a",
      sessionId: "search-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "rename_project_file", {
      input: { name: "lib.rs", path: "src/main.rs" },
      projectId: "project-a",
      rootPath: "/work/a",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "delete_project_file", {
      input: { path: "src/old.rs" },
      projectId: "project-a",
      rootPath: "/work/a",
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "read_project_source_file", {
      cursor: 10,
      path: "src/lib.rs",
      projectId: "project-a",
      rootPath: "/work/a",
      taskId: "task-a",
    });
  });

  it("routes Git reads through Tauri commands", async () => {
    const invoke = vi.fn(async () => ({}));
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await client.getProjectGitStatus("project-a", { rootPath: "/work/a" });
    await client.getProjectGitHistory("project-a", { cursor: "20", rootPath: "/work/a" });
    await client.getProjectGitCommitFiles("project-a", {
      rootPath: "/work/a",
      sha: "a".repeat(40),
    });
    await client.getProjectGitCommitFileDiff("project-a", {
      path: "src/main.rs",
      rootPath: "/work/a",
      sha: "a".repeat(40),
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "get_project_git_status", {
      input: { rootPath: "/work/a" },
      projectId: "project-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "get_project_git_history", {
      input: { cursor: "20", rootPath: "/work/a" },
      projectId: "project-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "get_project_git_commit_files", {
      input: { rootPath: "/work/a", sha: "a".repeat(40) },
      projectId: "project-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "get_project_git_commit_file_diff", {
      input: { path: "src/main.rs", rootPath: "/work/a", sha: "a".repeat(40) },
      projectId: "project-a",
    });
  });

  it("adds native request ids to cancellable Git and directory reads", async () => {
    const invoke = vi.fn(async (_command: string, _args?: Record<string, unknown>) => ({}));
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const signal = new AbortController().signal;
    const sha = "a".repeat(40);

    await client.getProjectGitStatus("project-a", { rootPath: "/work/a" }, { signal });
    await client.getProjectGitHistory("project-a", { rootPath: "/work/a" }, { signal });
    await client.getProjectGitCommitFiles("project-a", { rootPath: "/work/a", sha }, { signal });
    await client.getProjectGitCommitFileDiff(
      "project-a",
      { path: "src/main.rs", rootPath: "/work/a", sha },
      { signal },
    );
    await client.listProjectFiles("project-a", "/work/a", "src", { signal });

    for (const [, args] of invoke.mock.calls) {
      expect(args).toMatchObject({ requestId: expect.any(String) });
    }
  });

  it("stops an in-flight file search when its signal is aborted", async () => {
    let resolveSearch: (() => void) | undefined;
    const invoke = vi.fn(
      (command: string) =>
        new Promise<unknown>((resolve) => {
          if (command === "search_project_files") resolveSearch = () => resolve({ data: [] });
          else resolve({});
        }),
    );
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const controller = new AbortController();

    const search = client.searchProjectFiles(
      "project-a",
      "/work/a",
      "main",
      "search-a",
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(resolveSearch).toBeTypeOf("function"));
    controller.abort();
    resolveSearch?.();
    await search;

    expect(invoke).toHaveBeenCalledWith("stop_project_file_search", {
      projectId: "project-a",
      rootPath: "/work/a",
      sessionId: "search-a",
    });
  });

  it("does not start a file search with an already aborted signal", async () => {
    const invoke = vi.fn(async () => ({ data: [] }));
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.searchProjectFiles("project-a", "/work/a", "main", "search-a", {
        signal: controller.signal,
      }),
    ).rejects.toHaveProperty("name", "AbortError");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("preserves structured workspace errors", async () => {
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: vi.fn(async () =>
        Promise.reject({
          code: "SNAPSHOT_MISMATCH",
          message: "workspace snapshot changed; refresh and retry",
        }),
      ) as InvokeImplementation,
    });

    await expect(
      client.switchProjectBranch("project-a", "/work/a", {
        branch: "main",
        expectedSnapshot: "a".repeat(64),
      }),
    ).rejects.toEqual(
      new NativeCommandError(
        "SNAPSHOT_MISMATCH",
        "workspace snapshot changed; refresh and retry",
      ),
    );
  });

  it("preserves Codex RPC error details", async () => {
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: vi.fn(async () =>
        Promise.reject({
          code: "CODEX_RPC_ERROR",
          message: "invalid turn options",
          rpcCode: -32600,
        }),
      ) as InvokeImplementation,
    });

    const error = await client
      .switchProjectBranch("project-a", "/work/a", {
        branch: "main",
        expectedSnapshot: "a".repeat(64),
      })
      .catch((reason: unknown) => reason);

    expect(error).toEqual(
      new NativeCommandError("CODEX_RPC_ERROR", "invalid turn options", -32600),
    );
    expect(error).toHaveProperty("rpcCode", -32600);
  });
});
