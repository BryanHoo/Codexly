import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentProvider,
  AgentProviderEvent,
  AgentRuntimeProvider,
  CatalogOperations,
  LocalCatalogStore,
  LocalTask,
} from "@codexly/core";
import type { AgentTurnOptions, Project } from "@codexly/protocol";
import { enableClaudeRuntime } from "./cli-engine-runtime.js";
import { generateCommitMessageWithCodex } from "../packages/server/src/server-runtime.js";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  getSessionMessages: vi.fn(() => Promise.resolve([])),
  getSessionInfo: vi.fn(() => Promise.resolve(undefined)),
  deleteSession: vi.fn(() => Promise.resolve()),
  forkSession: vi.fn(),
}));

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const input = { text: "hello", files: [], images: [], skills: [], textAttachments: [] };
const options: AgentTurnOptions = {
  model: "default",
  reasoningEffort: "",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandboxMode: "workspace-write",
  engineOptions: { engine: "claude", permissionMode: "default" },
};

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "claude-web-lifecycle-"));
  roots.push(root);
  // 配置与 SDK 均隔离，回归验证不能读写用户的原生 Claude 配置或使用真实额度。
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "user"));
  vi.mocked(query)
    .mockReset()
    .mockImplementation(
      () =>
        ({
          async *[Symbol.asyncIterator]() {
            yield await Promise.resolve({
              type: "result",
              subtype: "success",
              result: "done",
              is_error: false,
            });
          },
          supportedModels: () => Promise.resolve([]),
          supportedCommands: () => Promise.resolve([]),
          accountInfo: () => Promise.resolve({ tokenSource: "none" }),
          close: vi.fn(),
        }) as unknown as Query,
    );
  const tasks = new Map<string, LocalTask>();
  const store = {
    catalog(operation: keyof CatalogOperations, payload: LocalTask) {
      if (operation === "task.read") return Promise.resolve(tasks.get(payload.id) ?? null);
      if (operation === "task.put" || operation === "task.patch") {
        const task = { ...tasks.get(payload.id), ...payload };
        tasks.set(task.id, task);
        return Promise.resolve(task);
      }
      throw new Error(`Unexpected catalog operation ${operation}`);
    },
  } as LocalCatalogStore;
  const codex = {
    subscribeEvents: vi.fn(() => () => undefined),
  } as unknown as AgentProvider;
  const codexRuntime = {
    forProject: vi.fn(() => codex),
    forTemporary: vi.fn(() => codex),
    releaseProject: vi.fn(() => Promise.resolve()),
  };
  const runtime = enableClaudeRuntime(
    codexRuntime as unknown as AgentRuntimeProvider,
    store,
    root,
    root,
  );
  const project = (id: string): Project => ({
    id,
    name: id,
    createdAt: "2026-10-16T00:00:00Z",
    roots: [{ id: `root-${id}`, path: root }],
  });
  const claude = runtime.engines?.claude;
  if (!claude) throw new Error("Missing Claude runtime");
  return { runtime, project, tasks, root, claude, codexRuntime };
}

it("does not create a Codex project or its watchers for Claude events and tasks", async () => {
  const { runtime, project, codexRuntime } = await harness();
  const router = runtime.forProject(project("p0"));
  const dispose = router.subscribeEvents(() => undefined);
  try {
    await router.startTask({ engine: "claude" });
    expect(codexRuntime.forProject).not.toHaveBeenCalled();
  } finally {
    dispose();
    await runtime.releaseProject("p0");
  }
  expect(codexRuntime.releaseProject).not.toHaveBeenCalled();
});

it("preserves ephemeral event subscriptions when lazily creating the Codex adapter", async () => {
  const { runtime, project, codexRuntime } = await harness();
  const p = project("helper");
  const underlying = codexRuntime.forProject();
  const subscribe = vi.fn<AgentProvider["subscribeEvents"]>(() => () => undefined);
  underlying.subscribeEvents = subscribe;
  underlying.getCapabilities = vi.fn(() => Promise.resolve({} as never));
  const router = runtime.forProject(p);
  const dispose = router.subscribeEvents(() => undefined, { includeEphemeral: true });
  try {
    await router.getCapabilities();
    expect(subscribe).toHaveBeenCalledWith(expect.any(Function), { includeEphemeral: true });
  } finally {
    dispose();
    await runtime.releaseProject(p.id);
  }
});

it("returns generated Git messages through the lazy router without waiting for the timeout", async () => {
  const { runtime, project, codexRuntime } = await harness();
  const underlying = codexRuntime.forProject();
  const subscriptions: { listener: (event: AgentProviderEvent) => void; ephemeral: boolean }[] = [];
  underlying.subscribeEvents = (listener, subscription) => {
    const entry = { listener, ephemeral: subscription?.includeEphemeral === true };
    subscriptions.push(entry);
    return () => {
      subscriptions.splice(subscriptions.indexOf(entry), 1);
    };
  };
  const task = {
    id: "helper",
    projectId: "p",
    title: "",
    pinned: false,
    updatedAt: "2026-10-19T00:00:00Z",
  };
  const turn = {
    id: "helper-turn",
    status: "running" as const,
    startedAt: task.updatedAt,
    completedAt: null,
    error: null,
    items: [],
  };
  underlying.startTask = vi.fn(() => Promise.resolve(task));
  const startTurn = vi.fn(() => Promise.resolve(turn));
  underlying.startTurn = startTurn;
  const unsubscribe = vi.fn(() => Promise.resolve("unsubscribed" as const));
  underlying.unsubscribeTask = unsubscribe;
  const router = runtime.forProject(project("p"));
  const visible = vi.fn();
  const dispose = router.subscribeEvents(visible);
  vi.useFakeTimers();
  try {
    const response = generateCommitMessageWithCodex(router, "Generate a message", options);
    void response.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(startTurn).toHaveBeenCalledOnce();
    for (const subscription of subscriptions) {
      if (!subscription.ephemeral) continue;
      subscription.listener({
        type: "item.completed",
        taskId: task.id,
        turnId: turn.id,
        itemId: "output",
        payload: {
          item: {
            id: "output",
            type: "message",
            role: "assistant",
            text: JSON.stringify({ message: "fix(git): 修复消息生成" }),
          },
        },
      });
      subscription.listener({
        type: "turn.completed",
        taskId: task.id,
        turnId: turn.id,
        payload: { turn: { ...turn, status: "completed" } },
      });
    }
    await vi.advanceTimersByTimeAsync(55_000);
    await expect(response).resolves.toBe("fix(git): 修复消息生成");
    expect(visible).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
    dispose();
    await runtime.releaseProject("p");
  }
});

it.each([
  ["disconnect", "project"],
  ["eviction", "project"],
  ["disconnect", "temporary"],
  ["eviction", "temporary"],
] as const)(
  "keeps the cached Web router subscribed after Claude adapter %s in %s scope",
  async (cause, kind) => {
    const { runtime, project, tasks, root, claude } = await harness();
    const current = () =>
      kind === "temporary" ? runtime.forTemporary(root) : runtime.forProject(project("p0"));
    const router = current();
    const events: AgentProviderEvent[] = [];
    const disposers = [router.subscribeEvents((event) => events.push(event))];
    const task = await router.startTask({ engine: "claude" });
    try {
      if (cause === "disconnect") {
        await claude.disconnect();
        await claude.configure({
          baseUrl: "https://example.test/claude",
          apiKey: "isolated-test-key",
        });
      } else {
        // 保留外层路由及订阅，确保第 17 个项目真正淘汰首个空闲适配器。
        for (let i = 1; i <= 16; i++) {
          const other = runtime.forProject(project(`p${String(i)}`));
          disposers.push(other.subscribeEvents(() => undefined));
        }
      }
      expect(current()).toBe(router);
      // 标题查询独立于主会话；路由重建仍须只启动一个执行查询。
      const executionCalls = () =>
        vi.mocked(query).mock.calls.filter(([call]) => call.options?.persistSession).length;
      const calls = executionCalls();
      const turn = await router.startTurn(task.id, input, options);
      expect(executionCalls()).toBe(calls + 1);
      // 等待消费与历史落盘结束，即使事件断言失败也不会与临时目录清理竞争。
      await vi.waitFor(() => {
        expect(tasks.get(task.id)?.status).toBe("idle");
      });
      expect(events.filter((event) => event.type === "turn.started")).toEqual([
        expect.objectContaining({ taskId: task.id, turnId: turn.id, provider: "claude" }),
      ]);
      await vi.waitFor(() => {
        expect(events.filter((event) => event.type === "turn.completed")).toEqual([
          expect.objectContaining({ taskId: task.id, turnId: turn.id, provider: "claude" }),
        ]);
      });
    } finally {
      disposers.forEach((dispose) => {
        dispose();
      });
      await runtime.releaseProject("temporary");
      for (let i = 0; i <= 16; i++) await runtime.releaseProject(`p${String(i)}`);
    }
  },
);
