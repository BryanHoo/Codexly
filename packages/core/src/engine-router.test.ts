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
});
