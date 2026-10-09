import { describe, expect, it } from "vitest";
import {
  createSplitLayout,
  splitLayout,
  remapSplitLayout,
  getSplitLayoutCells,
  getSplitShortcutDirection,
} from "./split-layout.js";

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("测试所需的窗口或布局不存在");
  return value;
}

describe("方向分屏布局", () => {
  it.each(["up", "down", "left", "right"] as const)("把新窗口放在目标窗口的 %s 侧", (direction) => {
    const layout = splitLayout("original", "original", "draft", direction);
    const cells = getSplitLayoutCells(layout);
    const first = defined(cells.get("original"));
    const second = defined(cells.get("draft"));
    if (direction === "left" || direction === "right") {
      expect(first.height).toBe(8);
      expect(second.width).toBe(4);
      expect(second.x - first.x).toBe(direction === "left" ? -4 : 4);
    } else {
      expect(first.width).toBe(8);
      expect(second.height).toBe(4);
      expect(second.y - first.y).toBe(direction === "up" ? -4 : 4);
    }
  });

  it("只切分目标窗口，相邻窗口保持原位置", () => {
    const first = splitLayout("one", "one", "two", "right");
    const next = splitLayout(first, "two", "three", "up");
    expect(getSplitLayoutCells(next).get("one")).toEqual(getSplitLayoutCells(first).get("one"));
    expect(getSplitLayoutCells(next).get("three")).toEqual({ x: 4, y: 0, width: 4, height: 4 });
    expect(splitLayout(next, "closed", "late", "left")).toBe(next);
  });

  it("从原有四屏布局开始切分，任务替换保留位置，关闭后兄弟窗口填满空间", () => {
    const layout = createSplitLayout(["one", "two", "three"]);
    expect(getSplitLayoutCells(defined(layout)).get("one")).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 8,
    });
    const renamed = remapSplitLayout(layout, (key) => (key === "two" ? "draft" : key));
    expect(getSplitLayoutCells(defined(renamed)).get("draft")).toEqual(
      getSplitLayoutCells(defined(layout)).get("two"),
    );
    const closed = remapSplitLayout(renamed, (key) => (key === "three" ? undefined : key));
    expect(getSplitLayoutCells(defined(closed)).get("draft")).toEqual({
      x: 4,
      y: 0,
      width: 4,
      height: 8,
    });
    expect(
      getSplitLayoutCells(defined(createSplitLayout(["one", "two", "three", "four"]))).get("four"),
    ).toEqual({ x: 4, y: 4, width: 4, height: 4 });
  });
});

describe("分屏快捷键", () => {
  const event = {
    altKey: true,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    key: "ArrowLeft",
    defaultPrevented: false,
    isComposing: false,
    repeat: false,
  };
  it.each([
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
  ])("识别 %s", (key, direction) => {
    expect(getSplitShortcutDirection({ ...event, key }, false)).toBe(direction);
    expect(getSplitShortcutDirection({ ...event, key, metaKey: true, ctrlKey: false }, true)).toBe(
      direction,
    );
  });
  it.each([
    { altKey: false },
    { shiftKey: true },
    { repeat: true },
    { isComposing: true },
    { defaultPrevented: true },
    { metaKey: true },
    { ctrlKey: false },
    { key: "a" },
  ])("忽略不匹配或已处理的按键 %o", (override) => {
    expect(getSplitShortcutDirection({ ...event, ...override }, false)).toBeUndefined();
  });
});
