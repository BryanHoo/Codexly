import { describe, expect, it, vi } from "vitest";
import { shallow } from "zustand/shallow";
import {
  createInspectorTaskSelector,
  selectTaskRuntimeMetadata,
} from "@codexly/frontend-core/task-view-selectors";
import { snapshotResponse } from "../../projects/project-queries.test-support.js";
import { createTaskStore, type TaskSnapshotMetadata } from "./task-store.js";

function fixture() {
  return createTaskStore({ projectId: "codexly", taskId: "task-1" }, snapshotResponse);
}

describe("共享工作台选择器的 Web 适配", () => {
  it("只订阅工作台字段，保留设置、目录、引擎与线程配置更新", () => {
    const store = fixture();
    let previous = selectTaskRuntimeMetadata(store.getState());
    const patches: Partial<TaskSnapshotMetadata>[] = [
      { title: "新的标题" },
      { status: "running" },
      { workspacePath: "/worktree" },
      { engine: "claude" },
      { settings: { ...snapshotResponse.snapshot.settings, model: "new-model" } },
      { threadConfiguration: { model: "new-model", reasoningEffort: "high" } },
    ];
    for (const patch of patches) {
      const metadata = store.getState().snapshotMetadata;
      if (metadata === null) throw new Error("样本任务必须已水合");
      store.setState({ snapshotMetadata: { ...metadata, ...patch } });
      const next = selectTaskRuntimeMetadata(store.getState());
      expect(shallow(previous, next)).toBe(false);
      expect(next).toMatchObject(patch);
      previous = next;
    }
    const metadata = store.getState().snapshotMetadata;
    if (metadata === null) throw new Error("样本任务必须已水合");
    store.setState({
      snapshotMetadata: {
        ...metadata,
        updatedAt: "2026-10-18T00:00:00Z",
        plan: { explanation: "仅右栏使用", steps: [] },
      },
    });
    expect(shallow(previous, selectTaskRuntimeMetadata(store.getState()))).toBe(true);
  });

  it("计划更新不扫描 Item，历史前插按顺序补充来源", () => {
    const store = fixture();
    const select = createInspectorTaskSelector();
    const initial = select(store.getState());
    const lookup = vi.spyOn(store.getState().itemStoresByKey, "get");
    const plan = { explanation: "新的计划", steps: [] };
    store.setState({ snapshotMetadata: { ...snapshotResponse.snapshot, plan } });
    expect(select(store.getState())?.plan).toBe(plan);
    expect(select(store.getState())?.turns).toBe(initial?.turns);
    expect(lookup).not.toHaveBeenCalled();
    const initialTurn = snapshotResponse.snapshot.turns[0];
    if (initialTurn === undefined) throw new Error("样本必须包含历史回合");
    store.getState().prependHistory({
      ...snapshotResponse,
      snapshot: {
        ...snapshotResponse.snapshot,
        turns: [
          {
            ...initialTurn,
            id: "older-turn",
            items: [{ id: "old-user", type: "message", role: "user", text: "之前的输入" }],
          },
        ],
      },
    });
    const projection = select(store.getState());
    expect(projection?.turns.map((turn) => turn.id)).toEqual(["older-turn", "turn-1"]);
    expect(projection?.turns[0]?.items[0]).toMatchObject({ id: "old-user", text: "之前的输入" });
    expect(projection?.turns[1]).toBe(initial?.turns[0]);
  });
});
