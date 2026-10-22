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
    expect(state).toEqual({ documents: [], activeId: null, direction: null });
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
});
