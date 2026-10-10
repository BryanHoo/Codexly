import { describe, expect, it, vi } from "vitest";
import { createSplitLayout, getSplitLayoutCells, resizeSplitLayout } from "./split-layout.js";
import { splitPaneKey } from "./split-workspace.js";
import {
  dismissSplitTask,
  syncSplitTaskRoute,
  type SplitWorkspaceSelection,
} from "./split-workspace-selection.js";

const task = (taskId: string) => ({ projectId: "project", taskId });
const panes = [task("one"), task("two"), task("three"), task("four")] as const;
const originalLayout = createSplitLayout(panes.map(splitPaneKey));
if (originalLayout === undefined) throw new Error("测试布局不存在");
const selection: SplitWorkspaceSelection = {
  panes,
  activeKey: splitPaneKey(panes[1]),
  routePaneKey: splitPaneKey(panes[0]),
  routeKey: "original",
  layout: resizeSplitLayout(originalLayout, "", 0.35),
};
const draft = { projectId: "project", draftId: "empty" };

describe("路由与删除更新分屏选择", () => {
  it("直接任务路由保留窗口数、相邻身份与分割比例", () => {
    const target = { projectId: "temporary", taskId: "search-result" };
    const next = syncSplitTaskRoute(selection, target, "next", true);
    expect(next.panes).toEqual([panes[0], target, panes[2], panes[3]]);
    expect(next.activeKey).toBe(splitPaneKey(target));
    expect(next.routeKey).toBe("next");
    expect(next.routePaneKey).toBe(splitPaneKey(target));
    if (next.layout === undefined || selection.layout === undefined)
      throw new Error("任务切换丢失布局");
    const before = getSplitLayoutCells(selection.layout);
    const after = getSplitLayoutCells(next.layout);
    for (const pane of [panes[0], panes[2], panes[3]]) {
      expect(after.get(splitPaneKey(pane))).toEqual(before.get(splitPaneKey(pane)));
    }
  });

  it("已打开任务的路由只切换焦点", () => {
    const next = syncSplitTaskRoute(selection, panes[3], "next", true);
    expect(next.panes).toBe(panes);
    expect(next.layout).toBe(selection.layout);
    expect(next.activeKey).toBe(splitPaneKey(panes[3]));
  });

  it("单窗口、移动端及工具页面保留普通路由行为", () => {
    expect(
      syncSplitTaskRoute({ ...selection, panes: panes.slice(0, 1) }, panes[1], "next", true).panes,
    ).toEqual([panes[1]]);
    expect(syncSplitTaskRoute(selection, panes[2], "next", false).panes).toEqual([panes[2]]);
    expect(syncSplitTaskRoute(selection, undefined, "tools", true).panes).toEqual([]);
  });

  it.each([0, 1])("移除第 %s 个任务只关闭对应窗口，并保留有效焦点", (index) => {
    const removed = panes[index];
    if (removed === undefined) throw new Error("测试任务不存在");
    const next = dismissSplitTask(selection, removed, () => draft);
    expect(next.panes).toEqual(panes.filter((pane) => pane !== removed));
    expect(next.panes.some((pane) => splitPaneKey(pane) === next.activeKey)).toBe(true);
    if (index === 0) expect(next.activeKey).toBe(selection.activeKey);
  });

  it("迟到删除不关闭已切换的新任务，项目身份独立", () => {
    const createDraft = vi.fn(() => draft);
    expect(dismissSplitTask(selection, { projectId: "other", taskId: "one" }, createDraft)).toBe(
      selection,
    );
    expect(
      dismissSplitTask(selection, { projectId: "project", taskId: "closed" }, createDraft),
    ).toBe(selection);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("移除分屏收敛后的最后任务时显示独立空草稿", () => {
    const last = panes[0];
    const next = dismissSplitTask(
      { ...selection, panes: [last], activeKey: splitPaneKey(last) },
      last,
      () => draft,
    );
    expect(next.panes).toEqual([draft]);
    expect(next.activeKey).toBe(splitPaneKey(draft));
  });
});
