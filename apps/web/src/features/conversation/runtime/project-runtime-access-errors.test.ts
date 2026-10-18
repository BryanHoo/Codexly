import { CodexlyEventError } from "@codexly/client";
import type { AgentTaskSnapshotResponse } from "@codexly/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { createProjectRuntimeManager } from "./project-runtime.js";
import { createTaskStore } from "./task-store.js";
import { createClientHarness, createSnapshotResponse } from "./project-runtime.test-support.js";

afterEach(() => vi.useRealTimers());

it.each([1008, 1002])(
  "shows terminal close %i and cancels pending snapshot recovery",
  async (closeCode) => {
    vi.useFakeTimers();
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    const snapshot = createSnapshotResponse("task-1");
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const pendingRecovery = Promise.withResolvers<AgentTaskSnapshotResponse>();
    const recover = vi.fn(() => pendingRecovery.promise);
    const detach = manager.attachTaskStore(snapshot, store, recover);
    try {
      harness.connectionState("reconnecting");
      expect(recover).toHaveBeenCalledOnce();
      const error = new CodexlyEventError("Access unavailable", { closeCode });
      harness.connectionError(error);
      harness.connectionState("closed");
      expect(store.getState().connectionState).toBe("closed");
      expect(store.getState().error).toBe(error);

      // 失效前发起的快照即使迟到，也不能恢复已终止的连接或覆盖错误状态。
      pendingRecovery.resolve(createSnapshotResponse("task-1", { sequence: 8 }));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(store.getState().checkpoint?.sequence).toBe(snapshot.checkpoint.sequence);
      expect(store.getState().connectionState).toBe("closed");
      expect(store.getState().error).toBe(error);
      expect(recover).toHaveBeenCalledOnce();
      expect(harness.client.subscribeEvents).toHaveBeenCalledOnce();

      const secondStore = createTaskStore({ projectId: "project-1", taskId: "task-2" });
      const detachSecond = manager.attachTaskStore(
        createSnapshotResponse("task-2"),
        secondStore,
        vi.fn(),
      );
      expect(secondStore.getState().connectionState).toBe("closed");
      expect(secondStore.getState().error).toBe(error);
      expect(harness.client.subscribeEvents).toHaveBeenCalledOnce();
      detachSecond();

      // 新运行会话显式提供有效快照后，允许重新建立订阅并清除终态错误。
      const renewed = {
        ...snapshot,
        checkpoint: { ...snapshot.checkpoint, sessionId: "runtime-2" },
      };
      manager.reconcileTaskSnapshot(renewed);
      harness.connectionState("connected");
      expect(store.getState().connectionState).toBe("connected");
      expect(store.getState().error).toBeNull();
      expect(harness.client.subscribeEvents).toHaveBeenCalledTimes(2);
      harness.connectionState("reconnecting");
      expect(recover).toHaveBeenCalledTimes(2);
    } finally {
      detach();
      manager.dispose();
    }
  },
);
