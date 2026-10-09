import { describe, expect, it } from "vitest";
import {
  addSplitPane,
  removeSplitPane,
  replaceSplitPane,
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
    const panes = [task("one"), task("two"), task("three"), task("four")];
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
});
