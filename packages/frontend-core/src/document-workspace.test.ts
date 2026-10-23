import { describe, expect, it } from "vitest";
import { createDocumentWorkspace, reduceDocumentWorkspace } from "./document-workspace.js";

describe("中栏文档工作区", () => {
  it("打开与重复定位文件只更新同一个标签，不影响聊天身份", () => {
    let state = createDocumentWorkspace<{ id: string; line: number }>();
    state = reduceDocumentWorkspace(state, { type: "open", document: { id: "a", line: 1 } });
    state = reduceDocumentWorkspace(state, { type: "open", document: { id: "b", line: 2 } });
    state = reduceDocumentWorkspace(state, { type: "open", document: { id: "a", line: 30 } });
    expect(state.documents).toEqual([
      { id: "a", line: 30 },
      { id: "b", line: 2 },
    ]);
    expect(state.activeId).toBe("a");
    expect(reduceDocumentWorkspace(state, { type: "select", id: null }).documents).toBe(
      state.documents,
    );
  });

  it("关闭当前标签选择相邻文件，关闭最后一个返回聊天并退出对照", () => {
    let state = createDocumentWorkspace<{ id: string }>();
    for (const id of ["a", "b", "c"])
      state = reduceDocumentWorkspace(state, { type: "open", document: { id } });
    state = reduceDocumentWorkspace(state, { type: "compare", direction: "right" });
    state = reduceDocumentWorkspace(state, { type: "close", id: "b" });
    expect(state.activeId).toBe("c");
    state = reduceDocumentWorkspace(state, { type: "close", id: "c" });
    expect(state.activeId).toBe("a");
    state = reduceDocumentWorkspace(state, { type: "close", id: "a" });
    expect(state).toEqual({ documents: [], pinnedIds: [], activeId: null, direction: null });
  });

  it("对照中打开其他文件沿用布局；返回聊天仍可恢复文档", () => {
    let state = createDocumentWorkspace<{ id: string }>();
    state = reduceDocumentWorkspace(state, { type: "open", document: { id: "a" } });
    state = reduceDocumentWorkspace(state, { type: "compare", direction: "down" });
    state = reduceDocumentWorkspace(state, { type: "open", document: { id: "b" } });
    expect(state.direction).toBe("down");
    state = reduceDocumentWorkspace(state, { type: "select", id: null });
    expect(state.direction).toBeNull();
    expect(state.documents).toHaveLength(2);
    expect(reduceDocumentWorkspace(state, { type: "select", id: "missing" })).toBe(state);
  });

  it("固定标签形成前缀，排序限制在分组内，重复打开保留固定和位置", () => {
    let state = createDocumentWorkspace(["a", "b", "c", "d"].map((id) => ({ id })));
    state = reduceDocumentWorkspace(state, { type: "pin", id: "c", pinned: true });
    state = reduceDocumentWorkspace(state, { type: "pin", id: "b", pinned: true });
    expect(state.documents.map((doc) => doc.id)).toEqual(["c", "b", "a", "d"]);
    state = reduceDocumentWorkspace(state, {
      type: "reorder",
      id: "b",
      targetId: "c",
      placement: "before",
    });
    expect(state.documents.map((doc) => doc.id)).toEqual(["b", "c", "a", "d"]);
    state = reduceDocumentWorkspace(state, {
      type: "reorder",
      id: "d",
      targetId: "b",
      placement: "before",
    });
    expect(state.documents.map((doc) => doc.id)).toEqual(["b", "c", "d", "a"]);
    state = reduceDocumentWorkspace(state, { type: "open", document: { id: "b" } });
    expect(state.documents.map((doc) => doc.id)).toEqual(["b", "c", "d", "a"]);
    expect(state.pinnedIds).toContain("b");
    state = reduceDocumentWorkspace(state, { type: "pin", id: "b", pinned: false });
    expect(state.documents.map((doc) => doc.id)).toEqual(["c", "b", "d", "a"]);
    expect(state.pinnedIds).toEqual(["c"]);
    expect(reduceDocumentWorkspace(state, { type: "pin", id: "missing", pinned: true })).toBe(
      state,
    );
    expect(
      reduceDocumentWorkspace(state, {
        type: "reorder",
        id: "b",
        targetId: "missing",
        placement: "after",
      }),
    ).toBe(state);
    expect(
      reduceDocumentWorkspace(state, {
        type: "reorder",
        id: "b",
        targetId: "b",
        placement: "after",
      }),
    ).toBe(state);
  });

  it("批量关闭保留固定标签和聊天，显式关闭固定项清理固定记录", () => {
    let state = createDocumentWorkspace(["a", "b", "c", "d"].map((id) => ({ id })));
    state = reduceDocumentWorkspace(state, { type: "pin", id: "b", pinned: true });
    state = reduceDocumentWorkspace(state, { type: "select", id: "c" });
    state = reduceDocumentWorkspace(state, { type: "compare", direction: "right" });
    state = reduceDocumentWorkspace(state, { type: "close-many", ids: ["b", "a", "c"] });
    expect(state.documents.map((doc) => doc.id)).toEqual(["b", "d"]);
    expect(state.activeId).toBe("d");
    expect(state.direction).toBe("right");
    state = reduceDocumentWorkspace(state, { type: "select", id: null });
    state = reduceDocumentWorkspace(state, { type: "close-many", ids: ["b", "d"] });
    expect(state.documents).toEqual([{ id: "b" }]);
    expect(state.activeId).toBeNull();
    state = reduceDocumentWorkspace(state, { type: "close", id: "b" });
    expect(state).toEqual(createDocumentWorkspace());
    expect(reduceDocumentWorkspace(state, { type: "close-many", ids: ["missing"] })).toBe(state);
  });
});
