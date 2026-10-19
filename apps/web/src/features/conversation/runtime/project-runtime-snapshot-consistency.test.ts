import type { AgentEvent, AgentTaskSnapshotResponse, PendingRequest } from "@codexly/protocol";
import { expect, it, vi } from "vitest";
import { createProjectRuntimeManager } from "./project-runtime.js";
import { createTaskStore } from "./task-store.js";
import {
  createClientHarness,
  createMessageDeltaEvent,
  createSnapshotResponse,
  createTurn,
} from "./project-runtime.test-support.js";

it.each(["initial load", "reconnect"])(
  "replays body, approvals and completion exactly once after %s",
  async (mode) => {
    const h = createClientHarness();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const manager = createProjectRuntimeManager(h.client);
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const recovery = Promise.withResolvers<AgentTaskSnapshotResponse>();
    const recover = vi.fn(() => recovery.promise);
    const initial = createSnapshotResponse("task-1");
    const item = {
      id: "message-task-1",
      type: "message" as const,
      role: "assistant" as const,
      text: "前",
    };
    const captured = {
      ...initial,
      checkpoint: { ...initial.checkpoint, sequence: 1 },
      snapshot: {
        ...initial.snapshot,
        turns: [{ ...createTurn("task-1"), items: [item] }],
      },
    };
    let detach: (() => void) | undefined;
    try {
      if (mode === "reconnect") detach = manager.attachTaskStore(initial, store, recover);
      else manager.observeSnapshot(initial);
      h.emit(createMessageDeltaEvent("task-1", 1, "前"));
      if (mode === "reconnect") {
        h.connectionState("reconnecting");
        await vi.waitFor(() => {
          expect(recover).toHaveBeenCalledOnce();
        });
      }
      // 快照覆盖至 1；请求返回前到达的 2..6 必须重放，已覆盖正文不能再追加。
      const completedItem = { ...item, text: "前后" };
      const completedTurn = { ...createTurn("task-1", "completed"), items: [completedItem] };
      const envelope = (sequence: number) => ({
        provider: "claude",
        taskId: "task-1",
        turnId: "turn-task-1",
        itemId: item.id,
        sessionId: "runtime-1",
        timestamp: "2026-10-17T00:00:00Z",
        version: 2 as const,
        sequence,
      });
      const request = {
        type: "tool_approval",
        requestId: "approval",
        projectId: "project-1",
        taskId: "task-1",
        turnId: "turn-task-1",
        itemId: "tool",
        createdAt: "2026-10-17T00:00:00Z",
        expiresAt: null,
        status: "pending",
        toolName: "Bash",
        input: { command: "pwd" },
        reason: null,
        availableDecisions: ["allow", "deny"],
      } satisfies PendingRequest;
      const events: AgentEvent[] = [
        createMessageDeltaEvent("task-1", 2, "后"),
        { ...envelope(3), type: "item.completed", payload: { item: completedItem } },
        { ...envelope(4), type: "pending_request.created", payload: { request } },
        {
          ...envelope(5),
          type: "pending_request.resolved",
          payload: { request: { ...request, status: "resolved" } },
        },
        { ...envelope(6), type: "turn.completed", payload: { turn: completedTurn } },
      ];
      for (const event of events) h.emit(event);
      if (mode === "reconnect") {
        recovery.resolve(captured);
        await vi.waitFor(() => {
          expect(store.getState().checkpoint?.sequence).toBe(6);
        });
      } else detach = manager.attachTaskStore(captured, store, recover);
      const assertFinal = () => {
        const state = store.getState();
        expect(state.checkpoint?.sequence).toBe(6);
        expect(state.getItem(item.id, completedTurn.id)).toMatchObject({ text: "前后" });
        expect(state.itemKeysByTurnId[completedTurn.id]).toHaveLength(1);
        expect(state.turnsById[completedTurn.id]?.status).toBe("completed");
        expect(state.snapshotMetadata?.status).toBe("idle");
        expect(
          state.pendingRequestIds.filter(
            (id) => state.pendingRequestsById[id]?.status === "pending",
          ),
        ).toEqual([]);
      };
      assertFinal();
      manager.reconcileTaskSnapshot({
        ...captured,
        checkpoint: { ...captured.checkpoint, sequence: 6 },
        snapshot: {
          ...captured.snapshot,
          status: "idle",
          turns: [completedTurn],
        },
      });
      assertFinal();
    } finally {
      detach?.();
      manager.dispose();
      vi.unstubAllGlobals();
    }
  },
);
