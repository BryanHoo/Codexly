import { describe, expect, it, vi } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import { createCodexRuntimeProvider } from "./agent-provider.js";
import {
  FakeRpcClient,
  projectRootPath,
  project,
  projectTaskScope,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider task lifecycle", () => {
  it("publishes Git metadata invalidation only for configured Project roots", () => {
    const provider = createCodexAgentProvider({ client: new FakeRpcClient([]), project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));

    expect(provider.publishProjectGitMetadataChanged(projectRootPath)).toBe(true);
    expect(provider.publishProjectGitMetadataChanged("/workspace/other")).toBe(false);
    expect(events).toEqual([
      {
        payload: { rootPath: projectRootPath },
        taskId: project.id,
        type: "project.git_metadata_changed",
      },
    ]);
  });

  it("uses 新聊天 until Codex provides a task title", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ name: null, preview: "" }) },
      { thread: nativeThread({ name: "Codex 返回的标题", preview: "忽略的预览" }) },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.startTask()).resolves.toMatchObject({ title: "新聊天" });
    await expect(provider.startTask()).resolves.toMatchObject({ title: "Codex 返回的标题" });
  });

  it("keeps a newly created task visible until Codex materializes it in the native list", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ name: null, preview: "" }) },
      { data: [], nextCursor: null },
      {
        data: [nativeThread({ name: "Codex 生成的标题", preview: "用户发送了你好" })],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.startTask()).resolves.toMatchObject({ id: "task-1", title: "新聊天" });
    await expect(provider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-1", title: "新聊天" }],
    });
    await expect(provider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-1", title: "Codex 生成的标题" }],
    });
  });

  it("keeps an ephemeral task out of the project task list", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ ephemeral: true }) },
      { data: [], nextCursor: null },
    ]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);

    await expect(provider.startTask({ ephemeral: true })).resolves.toMatchObject({ id: "task-1" });
    await expect(provider.listTasks()).resolves.toEqual({ data: [], nextCursor: null });
    expect(rpc.calls).toEqual([
      {
        method: "thread/start",
        params: {
          cwd: projectRootPath,
          ephemeral: true,
          historyMode: "paginated",
          projectId: project.id,
          runtimeWorkspaceRoots: [projectRootPath],
        },
      },
      {
        method: "thread/list",
        params: {
          projectId: project.id,
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      },
    ]);
  });

  it("keeps temporary tasks on the persistent unassigned thread path", async () => {
    const temporaryProject = {
      ...project,
      id: "temporary",
      name: "Temporary",
      rootPath: "/workspace/temporary",
      roots: [{ id: "root-temporary", path: "/workspace/temporary" }],
    };
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          cwd: temporaryProject.rootPath,
          ephemeral: true,
          projectId: null,
        }),
      },
      { data: [], nextCursor: null },
    ]);
    const runtime = createCodexRuntimeProvider({ client: rpc });
    const createTemporaryProvider = Reflect.get(runtime, "forTemporary");
    expect(createTemporaryProvider).toBeTypeOf("function");
    const provider = Reflect.apply(createTemporaryProvider, runtime, [temporaryProject.rootPath]);

    await provider.startTask();
    await provider.listTasks();

    expect(rpc.calls).toEqual([
      {
        method: "thread/start",
        params: {
          cwd: temporaryProject.rootPath,
          historyMode: "paginated",
          runtimeWorkspaceRoots: [temporaryProject.rootPath],
        },
      },
      {
        method: "thread/list",
        params: {
          cwd: temporaryProject.rootPath,
          projectId: null,
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      },
    ]);
  });

  it("publishes ephemeral task events only to explicit internal subscribers", async () => {
    const rpc = new FakeRpcClient([{ thread: nativeThread({ ephemeral: true }) }]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);
    const visibleEvents: AgentProviderEvent[] = [];
    const internalEvents: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => visibleEvents.push(event));
    provider.subscribeEvents((event) => internalEvents.push(event), { includeEphemeral: true });
    await provider.startTask({ ephemeral: true });

    rpc.emitNotification("item/agentMessage/delta", {
      delta: "hidden commit message",
      itemId: "message-1",
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(visibleEvents).toEqual([]);
    expect(internalEvents).toMatchObject([
      {
        itemId: "message-1",
        taskId: "task-1",
        turnId: "turn-1",
        type: "message.delta",
      },
    ]);
  });

  it("shares one RPC subscription across multiple project providers", async () => {
    const otherProject = {
      ...project,
      id: "other",
      name: "Other",
      rootPath: "/workspace/Other",
      roots: [{ id: "root-other", path: "/workspace/Other" }],
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      {
        data: [
          nativeThread({
            cwd: otherProject.rootPath,
            id: "task-2",
            projectId: otherProject.id,
          }),
        ],
        nextCursor: null,
      },
      {
        thread: nativeThread({
          cwd: otherProject.rootPath,
          id: "task-3",
          projectId: otherProject.id,
        }),
      },
    ]);
    const runtime = createCodexRuntimeProvider({ client: rpc });
    const projectProvider = runtime.forProject(project);
    const otherProvider = runtime.forProject(otherProject);

    await expect(projectProvider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-1", projectId: project.id }],
    });
    await expect(otherProvider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-2", projectId: otherProject.id }],
    });
    await expect(otherProvider.startTask()).resolves.toMatchObject({
      id: "task-3",
      projectId: otherProject.id,
    });

    expect(rpc.notificationListenerCount).toBe(1);
    expect(rpc.serverRequestListenerCount).toBe(1);
    expect(rpc.calls).toEqual([
      {
        method: "thread/list",
        params: {
          projectId: project.id,
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      },
      {
        method: "thread/list",
        params: {
          projectId: otherProject.id,
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      },
      {
        method: "thread/start",
        params: {
          cwd: otherProject.rootPath,
          historyMode: "paginated",
          projectId: otherProject.id,
          runtimeWorkspaceRoots: [otherProject.rootPath],
        },
      },
    ]);
    await expect(projectProvider.readTask("task-2")).resolves.toBeUndefined();
    expect(rpc.calls).toHaveLength(3);
    expect(() =>
      runtime.forProject({
        ...project,
        roots: [{ id: "root-conflicting", path: "/workspace/Conflicting" }],
      }),
    ).toThrow("project identity belongs to another cwd");
  });

  it("restores and permanently deletes an owned archived task", async () => {
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { thread: nativeThread({ name: "已恢复任务" }) },
      {},
    ]);
    const runtime = createCodexRuntimeProvider({ client: rpc });
    const provider = runtime.forProject(project);

    await provider.listTasks({ archived: true });
    await expect(provider.unarchiveTask("task-1")).resolves.toMatchObject({
      id: "task-1",
      projectId: project.id,
      title: "已恢复任务",
    });
    await expect(provider.deleteTask("task-1")).resolves.toBeUndefined();

    expect(runtime.isTaskOwner(projectTaskScope, "task-1")).toBe(false);
    expect(rpc.calls).toEqual([
      {
        method: "thread/list",
        params: {
          archived: true,
          projectId: project.id,
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      },
      { method: "thread/unarchive", params: { threadId: "task-1" } },
      { method: "thread/delete", params: { threadId: "task-1" } },
    ]);
  });

  it("publishes task state and skill invalidation notifications", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const runtime = createCodexRuntimeProvider({ client: rpc });
    const provider = runtime.forProject(project);
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    rpc.emitNotification("thread/status/changed", {
      status: { activeFlags: [], type: "active" },
      threadId: "task-1",
    });
    rpc.emitNotification("thread/name/updated", { threadId: "task-1", threadName: "Renamed" });
    rpc.emitNotification("skills/changed", {});
    rpc.emitNotification("thread/archived", { threadId: "task-1" });

    expect(events).toEqual([
      { payload: { status: "running" }, taskId: "task-1", type: "task.status_updated" },
      { payload: {}, taskId: "task-1", type: "task.metadata_changed" },
      { payload: {}, taskId: project.id, type: "skills.changed" },
      { payload: { reason: "archived" }, taskId: "task-1", type: "task.removed" },
    ]);
    expect(runtime.isTaskOwner(projectTaskScope, "task-1")).toBe(false);
  });

  it("validates background terminal ownership only on the first query", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { data: [], nextCursor: null },
      { data: [], nextCursor: null },
    ]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);

    await expect(provider.listBackgroundTerminals("task-1")).resolves.toEqual({ data: [] });
    await expect(provider.listBackgroundTerminals("task-1")).resolves.toEqual({ data: [] });

    expect(rpc.calls).toEqual([
      { method: "thread/read", params: { includeTurns: false, threadId: "task-1" } },
      { method: "thread/goal/get", params: { threadId: "task-1" } },
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
        method: "thread/backgroundTerminals/list",
        params: { limit: 100, threadId: "task-1" },
      },
      {
        method: "thread/backgroundTerminals/list",
        params: { limit: 100, threadId: "task-1" },
      },
    ]);
  });

  it("routes a review child thread through its parent task owner", async () => {
    const outerTurn = {
      completedAt: null,
      error: null,
      id: "review-outer-turn",
      items: [],
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const workerTurn = {
      ...outerTurn,
      id: "review-worker-turn",
      items: [],
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { reviewThreadId: "task-1", turn: outerTurn },
      { thread: nativeThread({ id: "reviewer-thread" }) },
    ]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();
    await provider.startReview("task-1", { type: "uncommitted_changes" });

    rpc.emitNotification("item/started", {
      item: { id: "review-mode", review: "current changes", type: "enteredReviewMode" },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("thread/started", {
      thread: {
        id: "reviewer-thread",
        parentThreadId: "task-1",
        source: { subAgent: "review" },
      },
    });
    await vi.waitFor(() => {
      expect(rpc.calls.at(-1)).toEqual({
        method: "thread/resume",
        params: { threadId: "reviewer-thread" },
      });
    });
    rpc.emitNotification("turn/started", {
      threadId: "reviewer-thread",
      turn: workerTurn,
    });
    rpc.emitNotification("item/started", {
      item: {
        command: "git diff",
        cwd: "/workspace",
        id: "review-command",
        status: "inProgress",
        type: "commandExecution",
      },
      threadId: "reviewer-thread",
      turnId: "review-worker-turn",
    });

    expect(
      events.map((event) => [event.type, event.taskId, "turnId" in event ? event.turnId : null]),
    ).toEqual([
      ["item.started", "task-1", "review-outer-turn"],
      ["turn.started", "task-1", "review-outer-turn"],
      ["item.started", "task-1", "review-outer-turn"],
    ]);
  });
});
