import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentProviderEvent } from "@code-agent/core";
import { createCodexRuntimeProvider } from "./agent-provider.js";
import {
  FakeRpcClient,
  projectRootPath,
  project,
  projectTaskScope,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider ownership and resume", () => {
  it("does not stop a replacement file search session during an old project release", async () => {
    let finishUnsubscribe!: (value: unknown) => void;
    const unsubscribeGate = new Promise<unknown>((resolve) => {
      finishUnsubscribe = resolve;
    });
    const rpc = new FakeRpcClient([{ thread: nativeThread() }, () => unsubscribeGate, {}, {}, {}]);
    const runtime = createCodexRuntimeProvider({ client: rpc });
    const oldProvider = runtime.forProject(project);
    await oldProvider.startTask();

    const releasing = runtime.releaseProject(project.id);
    await vi.waitFor(() => {
      expect(rpc.calls.at(-1)?.method).toBe("thread/unsubscribe");
    });

    const replacementProvider = runtime.forProject(project);
    expect(replacementProvider).not.toBe(oldProvider);
    const searchResult = runtime.fileSearch
      .search({
        projectId: project.id,
        query: "runtime",
        roots: [projectRootPath],
        sessionId: "replacement-search",
      })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    await vi.waitFor(() => {
      expect(rpc.calls.some(({ method }) => method === "fuzzyFileSearch/sessionUpdate")).toBe(true);
    });

    finishUnsubscribe({ status: "unsubscribed" });
    await releasing;
    rpc.emitNotification("fuzzyFileSearch/sessionUpdated", {
      files: [],
      query: "runtime",
      sessionId: "replacement-search",
    });
    rpc.emitNotification("fuzzyFileSearch/sessionCompleted", {
      sessionId: "replacement-search",
    });

    expect(await searchResult).toEqual({ value: { data: [] } });
    expect(rpc.calls.some(({ method }) => method === "fuzzyFileSearch/sessionStop")).toBe(false);
  });

  it("unsubscribes every native thread before releasing a busy project runtime", async () => {
    const runningTurn = (id: string) => ({
      completedAt: null,
      durationMs: null,
      error: null,
      id,
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    });
    const rpc = new FakeRpcClient([
      {
        data: [nativeThread(), nativeThread({ id: "task-2", sessionId: "native-session-2" })],
        nextCursor: null,
      },
      new Error("first unsubscribe failed"),
      { status: "notSubscribed" },
    ]);
    const logger = { warn: vi.fn() };
    const runtime = createCodexRuntimeProvider({ client: rpc, logger });
    const provider = runtime.forProject(project);
    await provider.listTasks();
    rpc.emitNotification("turn/started", {
      threadId: "task-1",
      turn: runningTurn("turn-1"),
    });
    rpc.emitNotification("turn/started", {
      threadId: "task-2",
      turn: runningTurn("turn-2"),
    });

    await expect(provider.unsubscribeTask("task-1")).resolves.toBe("busy");
    await runtime.releaseProject(project.id);

    expect(rpc.calls.filter(({ method }) => method === "thread/unsubscribe")).toEqual([
      { method: "thread/unsubscribe", params: { threadId: "task-1" } },
      { method: "thread/unsubscribe", params: { threadId: "task-2" } },
    ]);
    expect(runtime.isTaskOwner(projectTaskScope, "task-1")).toBe(false);
    expect(runtime.isTaskOwner(projectTaskScope, "task-2")).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      {
        diagnosticCode: "thread_unsubscribe_failed",
        projectId: project.id,
        taskId: "task-1",
      },
      "Failed to unsubscribe Codex thread during Project release",
    );
  });

  it("releases all project runtime state before the same identity is reused", async () => {
    vi.useFakeTimers();
    const imageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const imageUrl = `data:image/png;base64,${imageContent.toString("base64")}`;
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_232_400,
              error: null,
              id: "turn-image",
              items: [
                {
                  content: [
                    { text: "分析这张图", type: "text" },
                    { name: "diagram.png", type: "image", url: imageUrl },
                  ],
                  id: "message-image",
                  type: "userMessage",
                },
              ],
              startedAt: 1_753_228_800,
              status: "completed",
            },
          ],
        }),
      },
      { status: "unsubscribed" },
    ]);
    const runtime = createCodexRuntimeProvider({ client: rpc });
    const provider = runtime.forProject(project);

    try {
      await provider.listTasks();
      const snapshot = await provider.readTask("task-1");
      const item = snapshot?.turns[0]?.items[0];
      const attachmentId = item?.type === "message" ? item.attachments?.[0]?.id : undefined;
      if (attachmentId === undefined) {
        throw new Error("Expected historical attachment metadata");
      }
      rpc.emitServerRequest("timed-input", "item/tool/requestUserInput", {
        autoResolutionMs: 30_000,
        isBlocking: false,
        itemId: "timed-input-item",
        questions: [
          {
            header: "确认",
            id: "confirm",
            isOther: false,
            isSecret: false,
            options: [{ description: "继续", label: "Yes" }],
            question: "继续执行吗？",
          },
        ],
        threadId: "task-1",
        turnId: "turn-timed",
      });
      // 历史附件清理与 Pending Request 各持有一个受控 timer。
      expect(vi.getTimerCount()).toBe(2);

      await runtime.releaseProject(project.id);

      expect(vi.getTimerCount()).toBe(0);
      expect(runtime.isTaskOwner(projectTaskScope, "task-1")).toBe(false);
      runtime.claimTask(projectTaskScope, "task-1");
      await expect(provider.readTaskAttachment("task-1", attachmentId)).resolves.toBeUndefined();
      const replacement = runtime.forProject({
        ...project,
        roots: [{ id: "root-recreated", path: "/workspace/RecreatedCodeAgent" }],
      });
      expect(replacement).not.toBe(provider);
    } finally {
      vi.useRealTimers();
    }
  });

  it("matches Windows project paths without case sensitivity", async () => {
    const windowsProject = {
      ...project,
      rootPath: "C:\\Users\\Test\\CodeAgent",
      roots: [{ id: "root-windows", path: "C:\\Users\\Test\\CodeAgent" }],
    };
    const rpc = new FakeRpcClient([
      {
        data: [nativeThread({ cwd: "c:\\users\\test\\codeagent" })],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project: windowsProject });

    await expect(provider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-1", projectId: project.id }],
    });
  });

  it("revalidates ownership before a sidebar mutation on a released task", async () => {
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { data: [], nextCursor: null },
      { status: "unsubscribed" },
      { thread: nativeThread({ turns: [] }) },
      {},
    ]);
    const runtime = createCodexRuntimeProvider({ client: rpc });
    const provider = runtime.forProject(project);
    await provider.listTasks();
    await provider.unsubscribeTask("task-1");

    await expect(provider.renameTask("task-1", "释放后重命名")).resolves.toBeUndefined();

    expect(rpc.calls.slice(-3)).toEqual([
      {
        method: "thread/read",
        params: { includeTurns: false, threadId: "task-1" },
      },
      {
        method: "thread/turns/list",
        params: {
          itemsView: "full",
          limit: 10,
          sortDirection: "desc",
          threadId: "task-1",
        },
      },
      {
        method: "thread/name/set",
        params: { name: "释放后重命名", threadId: "task-1" },
      },
    ]);
  });

  it("resumes a persisted Codex task before continuing it after runtime restart", async () => {
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-after-restart",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { thread: nativeThread() },
      { turn: runningTurn },
    ]);
    const runtime = createCodexRuntimeProvider({ client: rpc });
    const provider = runtime.forProject(project);

    // 新 Runtime 只能先读取持久化历史，再显式恢复 Codex Thread 后继续发送。
    await expect(provider.readTask("task-1")).resolves.toMatchObject({ id: "task-1" });
    await expect(
      provider.startTurn(
        "task-1",
        { files: [], images: [], skills: [], text: "继续之前的任务", textAttachments: [] },
        {
          approvalPolicy: {
            granular: {
              mcp_elicitations: true,
              request_permissions: false,
              rules: true,
              sandbox_approval: false,
              skill_approval: true,
            },
          },
          approvalsReviewer: "auto_review",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      ),
    ).resolves.toMatchObject({ id: "turn-after-restart", status: "running" });

    expect(rpc.calls.map(({ method }) => method)).toEqual([
      "thread/read",
      "thread/turns/list",
      "thread/resume",
      "turn/start",
    ]);
    expect(rpc.calls[2]).toEqual({
      method: "thread/resume",
      params: { runtimeWorkspaceRoots: [projectRootPath], threadId: "task-1" },
    });
    expect(rpc.calls[3]).toMatchObject({
      method: "turn/start",
      params: {
        approvalPolicy: {
          granular: {
            mcp_elicitations: true,
            request_permissions: false,
            rules: true,
            sandbox_approval: false,
            skill_approval: true,
          },
        },
        approvalsReviewer: "auto_review",
        collaborationMode: {
          mode: "default",
          settings: {
            developer_instructions: null,
            model: "gpt-5.6-sol",
            reasoning_effort: "high",
          },
        },
        serviceTier: null,
      },
    });
  });

  it("uses the Codex fast service tier for a connected official ChatGPT account", async () => {
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-fast",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ status: { type: "active" } }) },
      { config: { model_provider: "openai", openai_base_url: null } },
      {
        account: { email: "developer@example.com", planType: "plus", type: "chatgpt" },
        requiresOpenaiAuth: true,
      },
      { turn: runningTurn },
    ]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);
    const task = await provider.startTask();

    await expect(
      provider.startTurn(
        task.id,
        { files: [], images: [], skills: [], text: "快速处理", textAttachments: [] },
        {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          fastMode: true,
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      ),
    ).resolves.toMatchObject({ id: "turn-fast", status: "running" });

    expect(rpc.calls.at(-1)).toMatchObject({
      method: "turn/start",
      params: { serviceTier: "fast" },
    });
  });

  it("steers the active Codex turn with the expected turn id", async () => {
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { turnId: "turn-1" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();

    await expect(
      provider.steerTurn("task-1", "turn-1", {
        files: [],
        images: [],
        skills: [],
        text: "优先修复失败测试",
        textAttachments: [],
      }),
    ).resolves.toBeUndefined();

    expect(rpc.calls.at(-1)).toEqual({
      method: "turn/steer",
      params: {
        expectedTurnId: "turn-1",
        input: [{ text: "优先修复失败测试", text_elements: [], type: "text" }],
        threadId: "task-1",
      },
    });
  });

  it("maps the complete persistent thread queue API", async () => {
    const attachmentRoot = mkdtempSync(join(tmpdir(), "code-agent-queue-file-"));
    const attachmentPath = join(attachmentRoot, "requirements.md");
    writeFileSync(attachmentPath, "队列附件内容", "utf8");
    const attachmentPlaceholder = `code-agent-file:${Buffer.from(
      JSON.stringify({ mediaType: "text/markdown", name: "requirements.md" }),
    ).toString("base64url")}`;
    const queuedSubmission = {
      clientUserMessageId: "client-message-1",
      id: "queue-1",
      input: [
        { text: "排队处理", text_elements: [], type: "text" },
        {
          text: attachmentPath,
          text_elements: [
            {
              byteRange: { end: Buffer.byteLength(attachmentPath, "utf8"), start: 0 },
              placeholder: attachmentPlaceholder,
            },
          ],
          type: "text",
        },
      ],
    };
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-2",
      items: [],
      itemsView: { type: "notLoaded" },
      startedAt: null,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { queuedSubmission },
      { data: [queuedSubmission], nextCursor: null },
      {
        queuedSubmission: {
          ...queuedSubmission,
          input: [{ text: "更新内容", text_elements: [], type: "text" }],
        },
      },
      { deleted: true },
      {},
      { thread: nativeThread() },
      { turn: runningTurn },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();
    const input = {
      files: [
        {
          mediaType: "text/markdown",
          name: "requirements.md",
          path: attachmentPath,
        },
      ],
      images: [],
      skills: [],
      text: "排队处理",
      textAttachments: [],
    };

    const added = await provider.queue.add("task-1", input, "client-message-1");
    expect(added).toMatchObject({
      clientUserMessageId: "client-message-1",
      id: "queue-1",
      text: "排队处理",
    });
    expect(added.attachments).toEqual([
      expect.objectContaining({
        kind: "file",
        mediaType: "text/markdown",
        name: "requirements.md",
      }),
    ]);
    await expect(provider.queue.list("task-1")).resolves.toEqual({
      data: [expect.objectContaining({ id: "queue-1", text: "排队处理" })],
      nextCursor: null,
    });
    await expect(
      provider.queue.update("task-1", "queue-1", { ...input, text: "更新内容" }),
    ).resolves.toMatchObject({ id: "queue-1", text: "更新内容" });
    await expect(provider.queue.delete("task-1", "queue-1")).resolves.toBe(true);
    await expect(provider.queue.reorder("task-1", ["queue-2", "queue-1"])).resolves.toBeUndefined();
    await expect(provider.queue.start("task-1", "queue-1")).resolves.toMatchObject({
      id: "turn-2",
      status: "running",
    });

    expect(
      rpc.calls
        .filter((call) => call.method.startsWith("thread/queue/"))
        .map((call) => call.method),
    ).toEqual([
      "thread/queue/add",
      "thread/queue/list",
      "thread/queue/update",
      "thread/queue/delete",
      "thread/queue/reorder",
      "thread/queue/start",
    ]);
    expect(rpc.calls.at(-1)?.params).toEqual({
      queuedSubmissionId: "queue-1",
      threadId: "task-1",
    });
    rmSync(attachmentRoot, { force: true, recursive: true });
  });

  it("publishes native thread queue changes", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    rpc.emitNotification("thread/queue/changed", { threadId: "task-1" });

    expect(events).toContainEqual({ payload: {}, taskId: "task-1", type: "queue.changed" });
  });

  it("shares one resume request across concurrent turns for a restored task", async () => {
    let resolveResume!: (response: unknown) => void;
    const resumeResponse = new Promise<unknown>((resolveResponse) => {
      resolveResume = resolveResponse;
    });
    const createRunningTurn = (turnId: string) => ({
      completedAt: null,
      durationMs: null,
      error: null,
      id: turnId,
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    });
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      () => resumeResponse,
      { turn: createRunningTurn("turn-concurrent-1") },
      { turn: createRunningTurn("turn-concurrent-2") },
    ]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);
    const turnOptions = {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    } as const;

    await provider.readTask("task-1");
    const firstTurn = provider.startTurn(
      "task-1",
      { files: [], images: [], skills: [], text: "并发消息一", textAttachments: [] },
      turnOptions,
    );
    const secondTurn = provider.startTurn(
      "task-1",
      { files: [], images: [], skills: [], text: "并发消息二", textAttachments: [] },
      turnOptions,
    );
    await Promise.resolve();

    // 两个续写请求必须等待同一个恢复操作，避免重复加载同一 Thread。
    expect(rpc.calls.map(({ method }) => method)).toEqual([
      "thread/read",
      "thread/turns/list",
      "thread/resume",
    ]);
    resolveResume({ thread: nativeThread() });
    await expect(Promise.all([firstTurn, secondTurn])).resolves.toMatchObject([
      { id: "turn-concurrent-1" },
      { id: "turn-concurrent-2" },
    ]);
    expect(rpc.calls.filter(({ method }) => method === "thread/resume")).toHaveLength(1);
  });
});
