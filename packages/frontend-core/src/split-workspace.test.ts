import { describe, expect, it } from "vitest";
import {
  addSplitPane,
  removeSplitPane,
  replaceSplitPane,
  selectSplitTask,
  splitPaneKey,
} from "./split-workspace.js";

const task = (taskId: string, projectId = "project") => ({ projectId, taskId });

describe("split workspace selection", () => {
  it("preserves existing pane identities and rejects duplicates", () => {
    const first = task("one");
    const panes = [first];
    expect(addSplitPane(panes, task("one"))).toBe(panes);
    expect(addSplitPane(panes, task("two"))[0]).toBe(first);
  });

  it("allows at most four tasks, including the original task", () => {
    const panes = [task("one"), task("two"), task("three"), task("four")] as const;
    expect(addSplitPane(panes, task("five"))).toBe(panes);
  });

  it("isolates identical task ids belonging to different projects", () => {
    expect(addSplitPane([task("one")], task("one", "other"))).toHaveLength(2);
    expect(splitPaneKey(task("c", "a:b"))).not.toBe(splitPaneKey(task("b:c", "a")));
  });

  it("closes a pane without replacing or clearing its siblings", () => {
    const panes = [task("one"), task("two"), task("three")] as const;
    const next = removeSplitPane(panes, panes[0]);
    expect(next).toEqual(panes.slice(1));
    expect(next[0]).toBe(panes[1]);
    expect(removeSplitPane([panes[0]], panes[0])).toEqual([panes[0]]);
  });

  it("replaces a forked task in place without duplicating an open task", () => {
    const panes = [task("one"), task("two")] as const;
    const next = replaceSplitPane(panes, panes[0], task("fork"));
    expect(next).toEqual([task("fork"), task("two")]);
    expect(next[1]).toBe(panes[1]);
    expect(replaceSplitPane(panes, panes[0], panes[1])).toEqual([panes[1]]);
  });

  it("ignores late task results after their pane has been closed", () => {
    const panes = [task("remaining")];
    expect(replaceSplitPane(panes, task("closed"), task("fork"))).toBe(panes);
  });

  it("在四屏上限时只替换聚焦窗口，保留其他窗口的位置和身份", () => {
    const panes = [task("one"), task("two"), task("three"), task("four")] as const;
    const selection = { panes, activeKey: splitPaneKey(panes[1]), routeKey: "original" };
    const next = selectSplitTask(selection, task("new", "other-project"));
    expect(next.panes).toEqual([panes[0], task("new", "other-project"), panes[2], panes[3]]);
    expect(next.activeKey).toBe(splitPaneKey(task("new", "other-project")));
    expect(next.routeKey).toBe(selection.routeKey);
    for (const index of [0, 2, 3]) expect(next.panes[index]).toBe(panes[index]);
  });

  it("选择已打开的任务只切换焦点，不删除原聚焦窗口", () => {
    const panes = [task("one"), task("two")] as const;
    const selection = { panes, activeKey: splitPaneKey(panes[0]) };
    const next = selectSplitTask(selection, task("two"));
    expect(next.panes).toBe(panes);
    expect(next.activeKey).toBe(splitPaneKey(panes[1]));
    expect(selectSplitTask(next, task("two"))).toBe(next);
  });

  it("按项目区分同名任务，且不恢复已经关闭的聚焦窗口", () => {
    const panes = [task("one"), task("two")] as const;
    expect(
      selectSplitTask({ panes, activeKey: splitPaneKey(panes[0]) }, task("two", "other")).panes,
    ).toEqual([task("two", "other"), panes[1]]);
    const closed = { panes, activeKey: splitPaneKey(task("closed")) };
    expect(selectSplitTask(closed, task("new"))).toBe(closed);
  });

  it("为同一项目的多个新建草稿保留独立身份，避免相互覆盖", () => {
    const firstDraft = { projectId: "project", draftId: "first" };
    const secondDraft = { projectId: "project", draftId: "second" };
    expect(splitPaneKey(firstDraft)).not.toBe(splitPaneKey(secondDraft));
    expect(splitPaneKey(firstDraft)).not.toBe(splitPaneKey(task("first")));
    const panes = [firstDraft, task("two"), task("three"), task("four")];
    const next = selectSplitTask({ panes, activeKey: splitPaneKey(task("two")) }, secondDraft);
    expect(next.panes).toEqual([firstDraft, secondDraft, panes[2], panes[3]]);
  });

  it("草稿首次发送后只替换所属窗口，迟到结果不能覆盖新草稿", () => {
    const firstDraft = { projectId: "project", draftId: "first" };
    const secondDraft = { projectId: "project", draftId: "second" };
    const panes = [firstDraft, task("other")];
    expect(replaceSplitPane(panes, firstDraft, task("created"))).toEqual([
      task("created"),
      panes[1],
    ]);
    const replaced = replaceSplitPane(panes, firstDraft, secondDraft);
    expect(replaceSplitPane(replaced, firstDraft, task("late"))).toBe(replaced);
  });
});
