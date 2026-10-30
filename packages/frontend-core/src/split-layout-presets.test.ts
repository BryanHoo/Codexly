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

  it.each([
    [1200, 600],
    [1000, 700],
    [800, 1000],
    [400, 1400],
    [2400, 600],
    [0, 0],
  ])("自适应在 %i×%i 中栏内按数量等分，二三屏横排、四屏田字格", (width, height) => {
    expect(cells(2, "auto", width, height)).toEqual(cells(2, "horizontal"));
    expect(cells(3, "auto", width, height)).toEqual(cells(3, "horizontal"));
    expect(cells(4, "auto", width, height)).toEqual(cells(4, "grid"));
  });
});
