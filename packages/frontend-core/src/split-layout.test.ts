import { describe, expect, it } from "vitest";
import {
  createSplitLayout,
  splitLayout,
  remapSplitLayout,
  getSplitLayoutCells,
  getSplitShortcutDirection,
  getSplitLayoutDividers,
  resizeSplitLayout,
} from "./split-layout.js";

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("测试所需的窗口或布局不存在");
  return value;
}

describe("方向分屏布局", () => {
  it("连续调整宽高比例，嵌套分割线只影响自己的窗口区域", () => {
    const original = defined(createSplitLayout(["one", "two", "three", "four"]));
    const wider = resizeSplitLayout(original, "", 0.65);
    const taller = resizeSplitLayout(wider, "1", 0.3);
    const cells = getSplitLayoutCells(taller);
    expect(cells.get("one")).toEqual({ x: 0, y: 0, width: 5.2, height: 4 });
    expect(cells.get("three")).toEqual({ x: 0, y: 4, width: 5.2, height: 4 });
    expect(cells.get("two")).toEqual({ x: 5.2, y: 0, width: 2.8, height: 2.4 });
    expect(cells.get("four")).toEqual({ x: 5.2, y: 2.4, width: 2.8, height: 5.6 });
    expect(getSplitLayoutDividers(taller)).toEqual([
      { path: "", axis: "horizontal", ratio: 0.65, x: 0, y: 0, width: 8, height: 8 },
      { path: "0", axis: "vertical", ratio: 0.5, x: 0, y: 0, width: 5.2, height: 8 },
      { path: "1", axis: "vertical", ratio: 0.3, x: 5.2, y: 0, width: 2.8, height: 8 },
    ]);
    expect(getSplitLayoutCells(original).get("one")?.width).toBe(4);
  });

  it("限制比例、防止迟到的拖动修改已关闭节点，任务替换与关闭保留其余比例", () => {
    const layout = defined(createSplitLayout(["one", "two", "three"]));
    expect(resizeSplitLayout(layout, "missing", 0.6)).toBe(layout);
    expect(resizeSplitLayout(layout, "", Number.NaN)).toBe(layout);
    expect(resizeSplitLayout(layout, "", 0.5)).toBe(layout);
    expect(getSplitLayoutCells(resizeSplitLayout(layout, "", 0)).get("one")?.width).toBe(0.8);
    expect(getSplitLayoutCells(resizeSplitLayout(layout, "", 1)).get("one")?.width).toBe(7.2);
    const resized = resizeSplitLayout(layout, "", 0.65);
    const renamed = remapSplitLayout(resized, (key) => (key === "one" ? "draft" : key));
    const closed = remapSplitLayout(renamed, (key) => (key === "three" ? undefined : key));
    expect(getSplitLayoutCells(defined(closed)).get("draft")?.width).toBe(5.2);
    expect(getSplitLayoutCells(defined(closed)).get("two")?.height).toBe(8);
    expect(getSplitLayoutDividers("only")).toEqual([]);
  });

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
