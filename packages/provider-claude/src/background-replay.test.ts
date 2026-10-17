import { expect, it } from "vitest";
import type { AgentEvent, AgentItem } from "@codexly/protocol";
import { ClaudeTurnProjection } from "./turn-projection.js";

interface ReplayState {
  snapshotMetadata: object;
  itemStoresByKey: Map<string, { read(): AgentItem }>;
  itemKeysByTurnId: Record<string, string[]>;
  turnsById: Record<string, object>;
  turnIds: string[];
  notices: object[];
  itemStructureRevision: number;
}

// 两端实际 reducer 消费相同 SDK 回放生成的事件；动态载入避免桌面专用类型别名进入 Web 类型图。
it.each(["completed", "failed", "stopped"] as const)(
  "replays background %s identically through Web and desktop reducers",
  async (outcome) => {
    const results: AgentItem[] = [];
    for (const client of ["apps/web", "desktop"]) {
      const path = `../../../${client}/src/features/conversation/runtime/task-store-events.ts`;
      const { applyAcceptedEvent } = (await import(path)) as {
        applyAcceptedEvent: (
          state: ReplayState,
          event: AgentEvent,
          changed: Set<unknown>,
        ) => Partial<ReplayState>;
      };
      let state: ReplayState = {
        snapshotMetadata: {},
        itemStoresByKey: new Map(),
        itemKeysByTurnId: {},
        turnsById: {},
        turnIds: [],
        notices: [],
        itemStructureRevision: 0,
      };
      let sequence = 0;
      const projection = new ClaudeTurnProjection("task", "turn", undefined, (event) => {
        // 模拟 Web JSON 与桌面宿主 stdio 的序列化边界，防止共享对象引用掩盖投影问题。
        const wire = JSON.parse(
          JSON.stringify({
            ...event,
            sequence: ++sequence,
            sessionId: "session",
            timestamp: "2026-10-17T00:00:00Z",
          }),
        ) as AgentEvent;
        state = { ...state, ...applyAcceptedEvent(state, wire, new Set()) };
      });
      state = {
        ...state,
        ...applyAcceptedEvent(
          state,
          {
            type: "turn.started",
            provider: "claude",
            version: 2,
            taskId: "task",
            turnId: "turn",
            sessionId: "session",
            sequence: 0,
            timestamp: "2026-10-17T00:00:00Z",
            payload: { turn: projection.snapshot() },
          },
          new Set(),
        ),
      };
      projection.receive({
        type: "assistant",
        message: {
          id: "root",
          content: [
            { type: "tool_use", id: "spawn", name: "Agent", input: { run_in_background: false } },
          ],
        },
      });
      for (const run_id of ["001", "002"])
        projection.receive({
          type: "system",
          subtype: "task_started",
          task_id: "child",
          tool_use_id: "spawn",
          run_id,
          is_backgrounded: false,
        });
      projection.receive({
        type: "system",
        subtype: "task_updated",
        task_id: "child",
        run_id: "002",
        patch: { is_backgrounded: true },
      });
      projection.receive({ type: "result", subtype: "success" });
      const read = () => state.itemStoresByKey.get('["turn","spawn"]')?.read();
      expect(read()).toMatchObject({ status: "running" });
      projection.receive({
        type: "system",
        subtype: "task_notification",
        task_id: "child",
        run_id: "001",
        status: "failed",
        summary: "obsolete",
      });
      expect(read()).toMatchObject({ status: "running" });
      projection.receive({
        type: "system",
        subtype: "task_notification",
        task_id: "child",
        run_id: "002",
        status: outcome,
        summary: "late proof",
      });
      const item = read();
      expect(item).toMatchObject({ status: outcome === "stopped" ? "interrupted" : outcome });
      expect(JSON.stringify(item)).toContain("late proof");
      expect(JSON.stringify(item)).not.toContain("obsolete");
      if (item) results.push(item);
    }
    // 子回合时间由投影生成；比较用户可见身份、状态和摘要，不比较墙钟时间。
    const visible = (item: AgentItem) =>
      item.type === "tool"
        ? { id: item.id, status: item.status, agents: (item.output as { agents: unknown }).agents }
        : item;
    expect(results.map(visible)[0]).toEqual(results.map(visible)[1]);
  },
);
