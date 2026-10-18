import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type * as Zustand from "zustand";

import { snapshotResponse } from "../../projects/project-queries.test-support.js";
import type { ProjectRuntimeManager } from "./project-runtime.js";
import { createTaskStore, type TaskStoreState } from "./task-store.js";
import { useTaskRuntime } from "./use-task-runtime.js";
import { useInspectorTask } from "../../workbench/components/use-inspector-task.js";

const probe = vi.hoisted(() => ({ selectors: [] as ((state: TaskStoreState) => unknown)[] }));

vi.mock("zustand", async (importOriginal) => {
  const actual = await importOriginal<typeof Zustand>();
  return {
    ...actual,
    useStore: ((store, selector) => {
      probe.selectors.push(selector as unknown as (state: TaskStoreState) => unknown);
      // 用 SSR 驱动 Hook，但选择当前状态以模拟客户端重新打开面板的读取语义。
      return actual.useStore({ ...store, getInitialState: store.getState }, selector);
    }) as typeof actual.useStore,
  };
});

describe("工作台运行时订阅", () => {
  it("对一万个历史 Item 的 120 批正文 Delta 保持所有订阅值稳定", () => {
    const initialTurn = snapshotResponse.snapshot.turns[0];
    if (initialTurn === undefined) throw new Error("样本必须包含历史回合");
    const store = createTaskStore(
      { projectId: "codexly", taskId: "task-1" },
      {
        ...snapshotResponse,
        snapshot: {
          ...snapshotResponse.snapshot,
          status: "running",
          turns: [
            {
              ...initialTurn,
              status: "running",
              error: null,
              items: Array.from({ length: 10_000 }, (_, index) => ({
                id: `answer-${String(index)}`,
                type: "message",
                role: "assistant",
                text: "历史正文",
              })),
            },
          ],
        },
      },
    );
    function Probe() {
      useTaskRuntime("codexly", "task-1", { client: {} } as ProjectRuntimeManager);
      useInspectorTask(store, true, undefined);
      return null;
    }
    probe.selectors = [];
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <Probe />
      </QueryClientProvider>,
    );
    // 捕获生产 Hook 实际传给 Zustand 的选择器，按 Object.is 模拟外部 Store 的变更判断。
    const values = probe.selectors.map((select) => select(store.getState()));
    const reconstruct = vi.spyOn(store.getState(), "reconstructSnapshot");
    const itemLookup = vi.spyOn(store.getState().itemStoresByKey, "get");
    let selectionChanges = 0;
    let metadataChanges = 0;
    let selectedItemReads = 0;
    const detach = store.subscribe((state, previous) => {
      if (state.snapshotMetadata !== previous.snapshotMetadata) metadataChanges++;
      const previousReads = itemLookup.mock.calls.length;
      probe.selectors.forEach((select, index) => {
        const next = select(state);
        if (!Object.is(next, values[index])) selectionChanges++;
        values[index] = next;
      });
      selectedItemReads += itemLookup.mock.calls.length - previousReads;
    });
    for (let sequence = 1; sequence <= 120; sequence++) {
      store.getState().applyEvents([
        {
          version: 2,
          provider: "codex",
          sessionId: "runtime-1",
          taskId: "task-1",
          turnId: "turn-1",
          itemId: "answer-9999",
          sequence,
          timestamp: new Date(Date.UTC(2026, 9, 18, 0, 0, sequence)).toISOString(),
          type: "message.delta",
          payload: { delta: "x" },
        },
      ]);
    }
    detach();
    expect(metadataChanges).toBe(120);
    expect(selectionChanges).toBe(0);
    expect(selectedItemReads).toBe(0);
    expect(reconstruct).not.toHaveBeenCalled();
    expect(store.getState().getItem("answer-9999", "turn-1")).toMatchObject({
      text: `历史正文${"x".repeat(120)}`,
    });
  });

  it("关闭右栏时不读取历史，重新打开时读取最新投影", () => {
    const store = createTaskStore({ projectId: "codexly", taskId: "task-1" }, snapshotResponse);
    const itemLookup = vi.spyOn(store.getState().itemStoresByKey, "get");
    let task: ReturnType<typeof useInspectorTask>;
    function Probe({ open }: { open: boolean }) {
      task = useInspectorTask(store, open, undefined);
      return null;
    }
    renderToStaticMarkup(<Probe open={false} />);
    expect(task).toBeUndefined();
    expect(itemLookup).not.toHaveBeenCalled();
    const plan = { explanation: "最新计划", steps: [] };
    store.setState({ snapshotMetadata: { ...snapshotResponse.snapshot, plan } });
    renderToStaticMarkup(<Probe open />);
    expect(task?.plan).toBe(plan);
    expect(task?.turns[0]?.items.map((item) => item.type)).toEqual(["message", "tool"]);
    expect(itemLookup).toHaveBeenCalled();
  });
});
