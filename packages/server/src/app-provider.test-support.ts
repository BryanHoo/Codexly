import type {
  AgentProvider,
  AgentProviderEvent,
  AgentProviderTaskSnapshot,
  AgentProviderTurnInput,
} from "@codexly/core";
import type { AgentBackgroundTerminalPage } from "@codexly/protocol";
import { vi } from "vitest";
import {
  historicalImageContent,
  modelPage,
  pendingRequest,
  snapshot,
  task,
} from "./app.test-support.js";

// 提供可观测的 AgentProvider mock，供路由领域测试按需覆盖。
export function createProvider() {
  const eventListeners = new Set<(event: AgentProviderEvent) => void>();
  const getCapabilities = vi.fn(() =>
    Promise.resolve({
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
  );
  const compactTask = vi.fn(() => Promise.resolve());
  const clearGoal = vi.fn<AgentProvider["clearGoal"]>(() => Promise.resolve());
  const readGoal = vi.fn<AgentProvider["readGoal"]>(() => Promise.resolve(snapshot.goal));
  const updateGoal = vi.fn<AgentProvider["updateGoal"]>(() =>
    Promise.reject(new Error("Goal is not configured")),
  );
  const archiveTask = vi.fn(() => Promise.resolve());
  const deleteTask = vi.fn(() => Promise.resolve());
  const forkTask = vi.fn(() => Promise.resolve({ ...task, id: "task-2", title: "续接任务" }));
  const listTasks = vi.fn(() => Promise.resolve({ data: [task], nextCursor: "next" }));
  const listModels = vi.fn(() => Promise.resolve(modelPage));
  const listMcpServers = vi.fn(() =>
    Promise.resolve({
      data: ["fast-context", "chrome-devtools"].map((name) => ({
        displayName: name,
        name,
        status: "connected" as const,
        toolCount: 2,
      })),
    }),
  );
  const reloadMcpServers = vi.fn(() =>
    Promise.resolve({
      data: [
        {
          displayName: "fast-context",
          name: "fast-context",
          status: "starting" as const,
          toolCount: 0,
        },
      ],
    }),
  );
  const listSkills = vi.fn(() =>
    Promise.resolve({
      data: [
        {
          description: "审查认证、授权和敏感数据边界",
          displayName: "Security review",
          id: "skill_01J00000000000000000000000",
          name: "review-security",
          scope: "system" as const,
        },
      ],
      nextCursor: null,
    }),
  );
  const readTask = vi.fn<
    (
      taskId: string,
      input?: Readonly<{ cursor?: string }>,
    ) => Promise<AgentProviderTaskSnapshot | undefined>
  >((taskId) => Promise.resolve(taskId === task.id ? snapshot : undefined));
  const readTaskAttachment = vi.fn((taskId: string, attachmentId: string) =>
    Promise.resolve(
      taskId === task.id && attachmentId === "history/image-1"
        ? {
            content: historicalImageContent,
            kind: "image" as const,
            mediaType: "image/png" as const,
            name: "diagram.png",
            size: historicalImageContent.byteLength,
          }
        : undefined,
    ),
  );
  const resolvePendingRequest = vi.fn(() =>
    Promise.resolve({ ...pendingRequest, status: "resolved" as const }),
  );
  const renameTask = vi.fn(() => Promise.resolve());
  const pinTask = vi.fn((taskId: string, pinned: boolean) =>
    Promise.resolve({ ...task, id: taskId, pinned }),
  );
  const startTask = vi.fn(() => Promise.resolve(task));
  const startTurn = vi.fn<AgentProvider["startTurn"]>(
    (taskId: string, input: AgentProviderTurnInput) =>
      Promise.resolve({
        completedAt: null,
        error: null,
        id: "turn-1",
        items: [
          { id: "input-1", role: "user" as const, text: input.text, type: "message" as const },
        ],
        startedAt: "2026-07-23T00:02:00.000Z",
        status: "running" as const,
      }),
  );
  const steerTurn = vi.fn<AgentProvider["steerTurn"]>(() => Promise.resolve());
  let queuedSubmissions: Awaited<ReturnType<NonNullable<AgentProvider["queue"]>["list"]>>["data"] =
    [];
  const queue = {
    add: vi.fn<NonNullable<AgentProvider["queue"]>["add"]>(
      (_taskId, input, clientUserMessageId) => {
        const queuedSubmission = {
          attachments: [],
          clientUserMessageId,
          id: `queue-${String(queuedSubmissions.length + 1)}`,
          skills: [...input.skills],
          status: "queued" as const,
          text: input.text,
        };
        queuedSubmissions = [...queuedSubmissions, queuedSubmission];
        return Promise.resolve(queuedSubmission);
      },
    ),
    delete: vi.fn<NonNullable<AgentProvider["queue"]>["delete"]>((_taskId, id) => {
      const retained = queuedSubmissions.filter((item) => item.id !== id);
      const deleted = retained.length !== queuedSubmissions.length;
      queuedSubmissions = retained;
      return Promise.resolve(deleted);
    }),
    list: vi.fn<NonNullable<AgentProvider["queue"]>["list"]>(() =>
      Promise.resolve({ data: queuedSubmissions, nextCursor: null }),
    ),
    reorder: vi.fn<NonNullable<AgentProvider["queue"]>["reorder"]>((_taskId, ids) => {
      const byId = new Map(queuedSubmissions.map((item) => [item.id, item]));
      queuedSubmissions = ids.flatMap((id) => byId.get(id) ?? []);
      return Promise.resolve();
    }),
    start: vi.fn<NonNullable<AgentProvider["queue"]>["start"]>(() =>
      Promise.resolve({
        completedAt: null,
        error: null,
        id: "queued-turn",
        items: [],
        startedAt: null,
        status: "running",
      }),
    ),
    update: vi.fn<NonNullable<AgentProvider["queue"]>["update"]>((_taskId, id, input) => {
      const current = queuedSubmissions.find((item) => item.id === id);
      if (current === undefined) {
        return Promise.reject(new Error("Queue item not found"));
      }
      const updated = { ...current, skills: [...input.skills], text: input.text };
      queuedSubmissions = queuedSubmissions.map((item) => (item.id === id ? updated : item));
      return Promise.resolve(updated);
    }),
  };
  const interruptTurn = vi.fn(() => Promise.resolve());
  const listBackgroundTerminals = vi.fn<() => Promise<AgentBackgroundTerminalPage>>(() =>
    Promise.resolve({ data: [] }),
  );
  const terminateBackgroundTerminal = vi.fn(() => Promise.resolve(true));
  const unsubscribeTask = vi.fn(() => Promise.resolve("unsubscribed" as const));
  const readSandboxMode = vi.fn(() => Promise.resolve("read-only" as const));
  const startReview = vi.fn(() =>
    Promise.resolve({
      completedAt: null,
      error: null,
      id: "review-turn",
      items: [],
      startedAt: "2026-07-25T00:00:00.000Z",
      status: "running" as const,
    }),
  );
  const uploadFeedback = vi.fn(() => Promise.resolve());
  const unarchiveTask = vi.fn(() => Promise.resolve(task));
  const provider: AgentProvider = {
    updateTurnApprovalsReviewer: vi.fn(() => Promise.resolve("applied" as const)),
    archiveTask,
    clearGoal,
    compactTask,
    deleteTask,
    forkTask,
    getCapabilities,
    interruptTurn,
    listBackgroundTerminals,
    listMcpServers,
    listModels,
    listSkills,
    listTasks,
    pinTask,
    queue,
    readGoal,
    readSandboxMode,
    readTask,
    readTaskAttachment,
    reloadMcpServers,
    renameTask,
    resolvePendingRequest,
    startTask,
    startReview,
    startTurn,
    steerTurn,
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    terminateBackgroundTerminal,
    unarchiveTask,
    unsubscribeTask,
    updateGoal,
    uploadFeedback,
  };
  return {
    archiveTask,
    clearGoal,
    compactTask,
    deleteTask,
    emitEvent: (event: AgentProviderEvent) => {
      for (const listener of eventListeners) {
        listener(event);
      }
    },
    eventListeners,
    forkTask,
    listTasks,
    listMcpServers,
    listModels,
    listSkills,
    interruptTurn,
    listBackgroundTerminals,
    pinTask,
    provider,
    queue,
    readGoal,
    readSandboxMode,
    readTask,
    readTaskAttachment,
    reloadMcpServers,
    renameTask,
    resolvePendingRequest,
    startTask,
    startReview,
    startTurn,
    steerTurn,
    terminateBackgroundTerminal,
    unarchiveTask,
    unsubscribeTask,
    updateGoal,
    uploadFeedback,
  };
}
