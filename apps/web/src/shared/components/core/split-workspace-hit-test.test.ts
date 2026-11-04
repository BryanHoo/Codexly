import { afterEach, describe, expect, it, vi } from "vitest";
import { isSplitBlankPoint } from "../../../../../../packages/ui/src/core/split-workspace-hit-test.js";

function setup({
  interactive = false,
  selected = false,
  text = false,
  workspace = false,
  chat = false,
} = {}) {
  const node = { nodeType: 3, textContent: "内容" };
  const rect = { left: 10, right: 30, top: 10, bottom: 20 };
  const range = {
    startContainer: node,
    startOffset: 1,
    setStart: vi.fn(),
    setEnd: vi.fn(),
    getClientRects: () => [rect],
  };
  class Target {
    ownerDocument = {
      getSelection: () => ({ isCollapsed: !selected }),
      caretRangeFromPoint: () => (text ? range : null),
    };
    closest(selector: string) {
      if (selector === "[data-document-workspace]") return workspace ? this : null;
      if (selector === ".document-workspace-chat") return chat ? this : null;
      return interactive ? this : null;
    }
    contains() {
      return true;
    }
  }
  vi.stubGlobal("Element", Target);
  vi.stubGlobal("Node", { TEXT_NODE: 3 });
  return new Target() as unknown as Element;
}

describe("中栏空白区域判定", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("允许容器空白和正文行尾留白", () => {
    expect(isSplitBlankPoint(setup(), 50, 50)).toBe(true);
    expect(isSplitBlankPoint(setup({ text: true }), 50, 15)).toBe(true);
  });
  it("保留实际正文字符、已选文本和控件的右键行为", () => {
    expect(isSplitBlankPoint(setup({ text: true }), 20, 15)).toBe(false);
    expect(isSplitBlankPoint(setup({ selected: true }), 50, 50)).toBe(false);
    expect(isSplitBlankPoint(setup({ interactive: true }), 50, 50)).toBe(false);
  });
  it("文档工作区只允许聊天区域空白触发分屏菜单", () => {
    expect(isSplitBlankPoint(setup({ workspace: true }), 50, 50)).toBe(false);
    expect(isSplitBlankPoint(setup({ workspace: true, chat: true }), 50, 50)).toBe(true);
  });
});
