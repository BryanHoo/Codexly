import type { SplitLayout } from "./split-layout.js";

export type SplitPaneCount = 2 | 3 | 4;
export type SplitLayoutPreset =
  "auto" | "horizontal" | "vertical" | "main-left" | "main-top" | "grid";
export type SplitWorkspaceSize = Readonly<{ width: number; height: number }>;

export const splitLayoutPresetGroups = [
  { count: 2, presets: ["auto", "horizontal", "vertical"] },
  { count: 3, presets: ["auto", "horizontal", "vertical", "main-left", "main-top"] },
  { count: 4, presets: ["auto", "horizontal", "vertical", "grid"] },
] as const;

function autoPreset(count: number, size: SplitWorkspaceSize): SplitLayoutPreset {
  // 点击时按中栏而非整窗的宽高选布局；极宽/极高区域使用等分，常规四屏优先田字格。
  const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 1.4;
  if (count === 2) return aspect >= 1 ? "horizontal" : "vertical";
  if (count === 3) {
    if (aspect >= 1.8) return "horizontal";
    if (aspect <= 0.75) return "vertical";
    return aspect >= 1 ? "main-left" : "main-top";
  }
  if (aspect >= 2.8) return "horizontal";
  return aspect <= 0.36 ? "vertical" : "grid";
}

function equalLayout(
  keys: readonly string[],
  axis: "horizontal" | "vertical",
): SplitLayout | undefined {
  if (keys.length <= 1) return keys[0];
  const middle = Math.ceil(keys.length / 2);
  const first = equalLayout(keys.slice(0, middle), axis);
  const second = equalLayout(keys.slice(middle), axis);
  if (first === undefined || second === undefined) return first;
  // 三屏不能逐次对半切，否则会得到 1/2、1/4、1/4；比例按每个子树的窗口数计算。
  return { axis, ratio: middle / keys.length, first, second };
}

export function createPresetSplitLayout(
  keys: readonly string[],
  preset: SplitLayoutPreset,
  size: SplitWorkspaceSize,
): SplitLayout | undefined {
  const panes = keys.slice(0, 4);
  const [one, two, three, four] = panes;
  if (one === undefined || two === undefined) return one;
  const resolved = preset === "auto" ? autoPreset(panes.length, size) : preset;
  if ((resolved === "main-left" || resolved === "main-top") && three !== undefined) {
    const horizontal = resolved === "main-left";
    return {
      axis: horizontal ? "horizontal" : "vertical",
      ratio: 0.6,
      first: one,
      second: equalLayout(panes.slice(1), horizontal ? "vertical" : "horizontal") ?? two,
    };
  }
  if (resolved === "grid" && three !== undefined && four !== undefined) {
    // 新预设使用行优先阅读顺序；保留旧任务菜单布局的坐标契约。
    return {
      axis: "vertical",
      first: { axis: "horizontal", first: one, second: two },
      second: { axis: "horizontal", first: three, second: four },
    };
  }
  return equalLayout(panes, resolved === "vertical" ? "vertical" : "horizontal");
}
