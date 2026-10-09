import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSplitLayoutCells } from "@codexly/frontend-core/split-layout";
import { ROUTE_SPLIT_DRAFT_ID, splitPaneKey } from "@codexly/frontend-core/split-workspace";
import {
  SplitPaneContext,
  SplitWorkspaceProvider,
  useSplitWorkspace,
  useNavigateSplitTask,
  useOpenSplitDraft,
} from "@codexly/ui/core/split-workspace";

const state = vi.hoisted(() => ({ selection: undefined as unknown }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof React>();
  return {
    ...react,
    // Node 环境只驱动 Provider 的状态更新，避免为共享状态回归启动独立浏览器。
    useState: <S,>(initial: S | (() => S)) => {
      const value = typeof initial === "function" ? (initial as () => S)() : initial;
      if (typeof value !== "object" || value === null || !("routeKey" in value))
        return react.useState(initial);
      state.selection ??= value;
      return [
        state.selection as S,
        (update: S | ((previous: S) => S)) => {
          state.selection =
            typeof update === "function"
              ? (update as (previous: S) => S)(state.selection as S)
              : update;
        },
      ];
    },
  };
});

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("测试所需的窗口或布局不存在");
  return value;
}

const original = { projectId: "project", taskId: "original" };
function setup() {
  let workspace: NonNullable<ReturnType<typeof useSplitWorkspace>> | undefined;
  function Probe() {
    workspace = defined(useSplitWorkspace());
    return null;
  }
  const read = () => {
    renderToStaticMarkup(
      <SplitWorkspaceProvider current={original} routeKey="original" desktop>
        <Probe />
      </SplitWorkspaceProvider>,
    );
    return defined(workspace);
  };
  return read;
}

describe("共享分屏操作", () => {
  beforeEach(() => {
    state.selection = undefined;
  });

  it.each([{ projectId: "project", draftId: ROUTE_SPLIT_DRAFT_ID }, original])(
    "普通单窗口保留导航，进入分屏后只替换所属窗口：%j",
    (current) => {
      let workspace: NonNullable<ReturnType<typeof useSplitWorkspace>> | undefined;
      let navigate: ReturnType<typeof useNavigateSplitTask> | undefined;
      let open: ReturnType<typeof useOpenSplitDraft> | undefined;
      function NavigationProbe() {
        navigate = useNavigateSplitTask();
        open = useOpenSplitDraft();
        return null;
      }
      function Probe() {
        workspace = defined(useSplitWorkspace());
        return (
          <SplitPaneContext
            value={{
              pane: current,
              active: true,
              multiple: workspace.panes.length > 1,
              toggleSidebar: () => undefined,
              sidebarOpen: true,
            }}
          >
            <NavigationProbe />
          </SplitPaneContext>
        );
      }
      const read = () =>
        renderToStaticMarkup(
          <SplitWorkspaceProvider current={current} routeKey="draft" desktop>
            <Probe />
          </SplitWorkspaceProvider>,
        );
      read();
      expect(defined(navigate)("project", "created")).toBe(false);
      expect(defined(open)("project")).toBe(false);
      defined(workspace).split(current, "down");
      read();
      const sibling = defined(workspace).panes[1];
      expect(defined(navigate)("project", "created")).toBe(true);
      read();
      expect(defined(workspace).panes).toEqual([
        { projectId: "project", taskId: "created" },
        sibling,
      ]);
    },
  );

  it("单窗口方向分屏打开独立草稿，相邻窗口保持身份；超过四屏不再添加", () => {
    const read = setup();
    read().split(original, "left");
    const first = read();
    expect(first.panes[0]).toBe(original);
    const draft = defined(first.panes[1]);
    expect(draft.projectId).toBe(original.projectId);
    expect(draft.taskId).toBeUndefined();
    expect(draft.draftId).toMatch(/^split-draft:/);
    expect(first.activeKey).toBe(splitPaneKey(draft));
    expect(getSplitLayoutCells(defined(first.layout)).get(defined(first.activeKey))).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 8,
    });
    read().split(draft, "up");
    read().split(original, "down");
    const full = read();
    expect(new Set(full.panes.map(splitPaneKey)).size).toBe(4);
    full.split(original, "right");
    expect(read().panes).toBe(full.panes);
  });

  it("新草稿转任务及左栏替换维持方向布局，选择已打开任务只切换焦点", () => {
    const read = setup();
    read().split(original, "down");
    const draft = defined(read().panes[1]);
    const position = getSplitLayoutCells(defined(read().layout)).get(splitPaneKey(draft));
    const created = { projectId: "project", taskId: "created" };
    read().replace(draft, created);
    expect(getSplitLayoutCells(defined(read().layout)).get(splitPaneKey(created))).toEqual(
      position,
    );
    const changed = { projectId: "other", taskId: "changed" };
    expect(read().select(changed)).toBe(true);
    expect(getSplitLayoutCells(defined(read().layout)).get(splitPaneKey(changed))).toEqual(
      position,
    );
    const panes = read().panes;
    read().select(original);
    expect(read().panes).toBe(panes);
    const layout = read().layout;
    read().replace(changed, changed);
    expect(read().layout).toBe(layout);
  });

  it("关闭、去重及迟到结果不留下空洞或恢复关闭窗口", () => {
    const read = setup();
    read().split(original, "right");
    const draft = defined(read().panes[1]);
    read().replace(draft, original);
    expect(read().layout).toBe(splitPaneKey(original));
    read().split(original, "up");
    const closed = defined(read().panes[1]);
    read().close(closed);
    read().replace(closed, { projectId: "project", taskId: "late" });
    expect(read().panes).toEqual([original]);
    expect(getSplitLayoutCells(defined(read().layout)).get(splitPaneKey(original))).toEqual({
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    });
    read().solo(original);
    expect(read().layout).toBeUndefined();
  });

  it("原任务入口保持默认布局，已使用方向分屏时追加到活动窗口右侧", () => {
    const read = setup();
    const task = { projectId: "project", taskId: "two" };
    read().add(task);
    expect(read().layout).toBeUndefined();
    read().split(task, "up");
    const active = defined(read().activeKey);
    const sibling = getSplitLayoutCells(defined(read().layout)).get(splitPaneKey(original));
    read().add({ projectId: "project", taskId: "four" });
    expect(read().panes).toHaveLength(4);
    expect(getSplitLayoutCells(defined(read().layout)).get(splitPaneKey(original))).toEqual(
      sibling,
    );
    expect(defined(getSplitLayoutCells(defined(read().layout)).get(active)).width).toBe(2);
  });
});
