import { describe, expect, it } from "vitest";
import { getSplitLayoutCells } from "./split-layout.js";
import { createPresetSplitLayout } from "./split-layout-presets.js";

const keys = ["current", "second", "third", "fourth"];
function cells(
  count: number,
  preset: Parameters<typeof createPresetSplitLayout>[1],
  width = 1000,
  height = 700,
) {
  const layout = createPresetSplitLayout(keys.slice(0, count), preset, { width, height });
  if (layout === undefined) throw new Error("预设布局不能为空");
  return getSplitLayoutCells(layout);
}

describe("中栏分屏布局预设", () => {
  it.each([2, 3, 4])("%i 屏横排和竖排都等分整个中栏", (count) => {
    const horizontal = cells(count, "horizontal");
    const vertical = cells(count, "vertical");
    keys.slice(0, count).forEach((key, index) => {
      expect(horizontal.get(key)?.x).toBeCloseTo((index * 8) / count);
      expect(horizontal.get(key)?.width).toBeCloseTo(8 / count);
      expect(horizontal.get(key)?.height).toBe(8);
      expect(vertical.get(key)?.y).toBeCloseTo((index * 8) / count);
      expect(vertical.get(key)?.height).toBeCloseTo(8 / count);
      expect(vertical.get(key)?.width).toBe(8);
    });
  });

  it("三屏主次布局让当前会话占较大区域，副屏等分剩余空间", () => {
    expect(cells(3, "main-left").get("current")).toEqual({ x: 0, y: 0, width: 4.8, height: 8 });
    expect(cells(3, "main-left").get("third")?.y).toBe(4);
    expect(cells(3, "main-top").get("current")).toEqual({ x: 0, y: 0, width: 8, height: 4.8 });
    expect(cells(3, "main-top").get("third")?.x).toBe(4);
  });

  it("田字四屏按阅读顺序排列", () => {
    expect([...cells(4, "grid").values()]).toEqual([
      { x: 0, y: 0, width: 4, height: 4 },
      { x: 4, y: 0, width: 4, height: 4 },
      { x: 0, y: 4, width: 4, height: 4 },
      { x: 4, y: 4, width: 4, height: 4 },
    ]);
  });

  it("自适应依据中栏实际宽高选择布局，尺寸不可用时也能分屏", () => {
    expect(cells(2, "auto", 1200, 600)).toEqual(cells(2, "horizontal"));
    expect(cells(2, "auto", 600, 900)).toEqual(cells(2, "vertical"));
    expect(cells(3, "auto", 1800, 600)).toEqual(cells(3, "horizontal"));
    expect(cells(3, "auto", 1000, 700)).toEqual(cells(3, "main-left"));
    expect(cells(3, "auto", 800, 1000)).toEqual(cells(3, "main-top"));
    expect(cells(3, "auto", 400, 1200)).toEqual(cells(3, "vertical"));
    expect(cells(4, "auto", 1000, 700)).toEqual(cells(4, "grid"));
    expect(cells(4, "auto", 2400, 600)).toEqual(cells(4, "horizontal"));
    expect(cells(4, "auto", 400, 1400)).toEqual(cells(4, "vertical"));
    expect(cells(4, "auto", 0, 0)).toEqual(cells(4, "grid"));
  });
});
