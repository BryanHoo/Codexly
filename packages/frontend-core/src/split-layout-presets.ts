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
  _size: SplitWorkspaceSize,
): SplitLayout | undefined {
  const panes = keys.slice(0, 4);
  const [one, two, three, four] = panes;
  if (one === undefined || two === undefined) return one;
  // 自适应按数量选择舒适等分，不因中栏宽高变成主次屏或过窄的四列布局。
  const resolved = preset === "auto" ? (panes.length === 4 ? "grid" : "horizontal") : preset;
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
