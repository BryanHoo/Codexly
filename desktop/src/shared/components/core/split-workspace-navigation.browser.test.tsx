import { describe, expect, it } from "vitest";
import { measureSplitWorkspaceNavigation } from "./split-workspace-navigation.fixture";

describe("任务导航和移除保留分屏", () => {
  it.each([false, true])("保留其他窗口、布局和草稿（desktop=%s）", (desktop) => {
    const result = measureSplitWorkspaceNavigation(desktop);
    expect(result.route).toEqual({ count: 4, activeKey: JSON.stringify(["temporary", "search-result"]), sameNeighbor: true, draft: "保留相邻窗口草稿" });
    expect(result.duplicate).toEqual({ handled: true, count: 4, activeKey: JSON.stringify(["project", "four"]), restoredToActive: true });
    expect(result.inactiveRemoval).toEqual({ removed: true, count: 3, activeKey: JSON.stringify(["project", "four"]) });
    expect(result.activeRemoval.count).toBe(2);
    expect(result.single).toEqual({ count: 1, sameEditor: true });
    expect(result.empty.count).toBe(1);
    expect(result.empty.draftId).toBeDefined();
    expect(result.singleRouteCount).toBe(1);
  });
});
