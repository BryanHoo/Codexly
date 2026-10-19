import { describe, expect, it, vi } from "vitest";
import type { AgentProviderEventListener } from "./agent-provider.js";
import type { LocalCatalogStore, LocalTask } from "./local-catalog.js";
import { EngineProjectRouter, type AgentExecutionAdapter } from "./engine-router.js";

describe("application task engine routing", () => {
  function setup() {
    const tasks = new Map<string, LocalTask>(
      ["codex", "claude"].map((provider) => [
        provider,
        {
          id: provider,
          provider,
          sessionId: "same-native",
          projectId: "p",
          cwd: "/project",
          title: provider,
          pinned: false,
          archived: false,
          status: "idle",
          updatedAt: 1,
        },
      ]),
    );
    const listeners = new Map<string, AgentProviderEventListener>();
    const adapter = (engine: string) => ({
      startTask: vi.fn(() => Promise.resolve({ id: `new-${engine}`, engine })),
      startTurn: vi.fn(() => Promise.resolve({ id: `${engine}-turn` })),
      readTask: vi.fn((id: string) => Promise.resolve({ id, engine })),
      subscribeEvents: (listener: AgentProviderEventListener) => {
        listeners.set(engine, listener);
        return () => {
          listeners.delete(engine);
        };
      },
    });
    const codex = adapter("codex"),
      claude = adapter("claude");
    const store = {
      catalog: vi.fn((operation: string, input: { id: string }) => {
        if (operation === "task.read") return Promise.resolve(tasks.get(input.id) ?? null);
        if (operation === "task.list")
          return Promise.resolve({ data: [...tasks.values()], nextCursor: null });
        throw new Error(operation);
      }),
    } as unknown as LocalCatalogStore;
    const router = new EngineProjectRouter(
      { id: "p", kind: "project", rootPath: "/project", runtimeWorkspaceRoots: ["/project"] },
      store,
      {
        codex: codex as unknown as AgentExecutionAdapter,
        claude: claude as unknown as AgentExecutionAdapter,
      },
    );
    return { router, codex, claude, tasks, listeners };
  }

  it("selects the engine only during creation and routes reads by persisted identity", async () => {
    const { router, codex, claude } = setup();
    await router.startTask({ engine: "claude" });
    expect(claude.startTask).toHaveBeenCalledOnce();
    expect(codex.startTask).not.toHaveBeenCalled();
    await router.readTask("codex");
    await router.readTask("claude");
    expect(codex.readTask).toHaveBeenCalledWith("codex", undefined);
    expect(claude.readTask).toHaveBeenCalledWith("claude", undefined);
  });

  it("routes ephemeral generation without a catalog row and hides its events from normal listeners", async () => {
    const { router, codex, listeners, tasks } = setup();
    const visible = vi.fn(),
      helper = vi.fn();
    router.subscribeEvents(visible);
    router.subscribeEvents(helper, { includeEphemeral: true });
    const task = await router.startTask({ ephemeral: true });
    expect(tasks.has(task.id)).toBe(false);
    await router.startTurn(task.id, {} as never, {} as never);
    expect(codex.startTurn).toHaveBeenCalledOnce();
    listeners.get("codex")?.({ type: "task.metadata_changed", taskId: task.id, payload: {} });
    expect(visible).not.toHaveBeenCalled();
    expect(helper).toHaveBeenCalledOnce();
  });

  it("keeps offline mixed-engine lists and rejects cross-project task access", async () => {
    const { router, tasks } = setup();
    expect((await router.listTasks()).data.map((task) => task.engine)).toEqual(["codex", "claude"]);
    const original = tasks.get("claude");
    if (!original) throw new Error("Missing fixture task");
    tasks.set("foreign", { ...original, id: "foreign", projectId: "other" });
    await expect(router.readTask("foreign")).rejects.toThrow(/project/i);
    expect(await router.readTaskMetadata("foreign")).toBeUndefined();
  });

  it("preserves event engine identities and releases both subscriptions", () => {
    const { router, listeners } = setup();
    const receive = vi.fn();
    const unsubscribe = router.subscribeEvents(receive);
    const listener = listeners.get("claude");
    if (!listener) throw new Error("Missing event listener");
    listener({
      type: "task.status_updated",
      taskId: "claude",
      payload: { status: "running" },
    });
    expect(receive).toHaveBeenCalledWith({
      type: "task.status_updated",
      taskId: "claude",
      payload: { status: "running" },
      provider: "claude",
    });
    unsubscribe();
    expect(listeners.size).toBe(0);
  });

  it("moves all listeners before invoking a replacement adapter and releases the current subscriptions", async () => {
    const h = setup();
    let current = h.claude as unknown as AgentExecutionAdapter;
    const router = new EngineProjectRouter(h.router.scope, h.router.store, {
      codex: h.codex as unknown as AgentExecutionAdapter,
      claude: () => current,
    });
    const first = vi.fn(),
      second = vi.fn();
    const unsubscribeFirst = router.subscribeEvents(first);
    const unsubscribeSecond = router.subscribeEvents(second);
    const emit = (listener: AgentProviderEventListener) => {
      listener({ type: "task.metadata_changed", taskId: "claude", payload: {} });
    };
    const listeners = new Set<AgentProviderEventListener>();
    const dispose = vi.fn();
    const subscribe = vi.fn((listener: AgentProviderEventListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        dispose();
      };
    });
    current = {
      ...current,
      subscribeEvents: subscribe,
      readTask: vi.fn(() => {
        // 同步发布也必须送达，不能等本次调用完成后才迁移订阅。
        listeners.forEach(emit);
        return Promise.resolve(undefined);
      }),
    };
    await router.readTask("claude");
    expect(subscribe).toHaveBeenCalledOnce();
    expect(h.listeners.has("claude")).toBe(false);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledWith({
      type: "task.metadata_changed",
      taskId: "claude",
      payload: {},
      provider: "claude",
    });

    unsubscribeFirst();
    await router.readTask("claude");
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    expect(subscribe).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    unsubscribeSecond();
    expect(listeners.size).toBe(0);
    expect(h.listeners.size).toBe(0);
    expect(dispose).toHaveBeenCalledOnce();

    // 全部取消后，再订阅仍能使用当前适配器，且不会重复派发事件。
    const unsubscribeAgain = router.subscribeEvents(first);
    await router.readTask("claude");
    expect(first).toHaveBeenCalledTimes(2);
    expect(subscribe).toHaveBeenCalledTimes(2);
    unsubscribeAgain();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
