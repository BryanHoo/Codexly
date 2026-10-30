export type SplitDirection = "up" | "down" | "left" | "right";
export type SplitLayout =
  | string
  | Readonly<{
      axis: "horizontal" | "vertical";
      ratio?: number;
      first: SplitLayout;
      second: SplitLayout;
    }>;

export function createSplitLayout(keys: readonly string[]): SplitLayout | undefined {
  const [one, two, three, four] = keys;
  if (one === undefined || two === undefined) return one;
  // 默认按窗口数量整体等分，避免逐次对半切产生 1/2、1/4、1/4 的窄窗口。
  if (three === undefined) return { axis: "horizontal", first: one, second: two };
  if (four === undefined) {
    return {
      axis: "horizontal",
      ratio: 1 / 3,
      first: one,
      second: { axis: "horizontal", first: two, second: three },
    };
  }
  return {
    axis: "horizontal",
    first: { axis: "vertical", first: one, second: three },
    second: { axis: "vertical", first: two, second: four },
  };
}

function orderedSplitKeys(layout: SplitLayout): string[] {
  // 布局树的遍历顺序可能按列排列；按实际坐标恢复从上到下、从左到右的阅读顺序。
  return [...getSplitLayoutCells(layout)]
    .sort(([, first], [, second]) => first.y - second.y || first.x - second.x)
    .map(([key]) => key);
}

export function splitLayout(
  layout: SplitLayout,
  target: string,
  added: string,
  direction: SplitDirection,
): SplitLayout {
  const keys = orderedSplitKeys(layout);
  if (direction === "left" || direction === "right" || keys.length === 3) {
    const index = keys.indexOf(target);
    if (index === -1 || keys.includes(added)) return layout;
    // 新窗口按方向紧邻目标插入；横向添加整体等分，第四屏统一收敛为田字格。
    keys.splice(index + (direction === "right" || direction === "down" ? 1 : 0), 0, added);
    return createSplitLayout(keys) ?? layout;
  }
  if (typeof layout === "string") {
    if (layout !== target) return layout;
    const before = direction === "up";
    return {
      axis: "vertical",
      first: before ? added : target,
      second: before ? target : added,
    };
  }
  const first = splitLayout(layout.first, target, added, direction);
  const second = splitLayout(layout.second, target, added, direction);
  return first === layout.first && second === layout.second ? layout : { ...layout, first, second };
}

export function remapSplitLayout(
  layout: SplitLayout | undefined,
  map: (key: string) => string | undefined,
): SplitLayout | undefined {
  if (layout === undefined) return undefined;
  const keys = orderedSplitKeys(layout);
  const mappedKeys = new Map<string, string>();
  const remap = (node: SplitLayout): SplitLayout | undefined => {
    if (typeof node === "string") {
      const key = map(node);
      if (key !== undefined) mappedKeys.set(node, key);
      return key;
    }
    const first = remap(node.first);
    const second = remap(node.second);
    if (first === undefined) return second;
    if (second === undefined) return first;
    return first === node.first && second === node.second ? node : { ...node, first, second };
  };
  const next = remap(layout);
  // 身份替换、位置交换继续保留手动比例；仅真正减少窗口时按原可见顺序整体重排。
  return mappedKeys.size < keys.length
    ? createSplitLayout(keys.flatMap((key) => mappedKeys.get(key) ?? []))
    : next;
}

export const MIN_SPLIT_RATIO = 0.1;
export const MAX_SPLIT_RATIO = 0.9;

export function resizeSplitLayout(layout: SplitLayout, path: string, ratio: number): SplitLayout {
  if (typeof layout === "string" || !Number.isFinite(ratio)) return layout;
  if (path === "") {
    const nextRatio = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
    return nextRatio === (layout.ratio ?? 0.5) ? layout : { ...layout, ratio: nextRatio };
  }
  // 路径描述切分节点而非任务身份；替换任务保留比例，关闭后不存在的节点不响应。
  const branch = path.startsWith("0") ? "first" : path.startsWith("1") ? "second" : undefined;
  if (branch === undefined) return layout;
  const next = resizeSplitLayout(layout[branch], path.slice(1), ratio);
  return next === layout[branch] ? layout : { ...layout, [branch]: next };
}

export type SplitLayoutCell = Readonly<{ x: number; y: number; width: number; height: number }>;
export type SplitLayoutDivider = SplitLayoutCell &
  Readonly<{ path: string; axis: "horizontal" | "vertical"; ratio: number }>;

function visitSplitLayout(
  layout: SplitLayout,
  onPane: (key: string, cell: SplitLayoutCell) => void,
  onDivider: (divider: SplitLayoutDivider) => void,
) {
  const visit = (node: SplitLayout, cell: SplitLayoutCell, path: string) => {
    if (typeof node === "string") {
      onPane(node, cell);
      return;
    }
    const ratio = node.ratio ?? 0.5;
    onDivider({ ...cell, path, axis: node.axis, ratio });
    if (node.axis === "horizontal") {
      const width = cell.width * ratio;
      visit(node.first, { ...cell, width }, `${path}0`);
      visit(node.second, { ...cell, x: cell.x + width, width: cell.width - width }, `${path}1`);
    } else {
      const height = cell.height * ratio;
      visit(node.first, { ...cell, height }, `${path}0`);
      visit(node.second, { ...cell, y: cell.y + height, height: cell.height - height }, `${path}1`);
    }
  };
  // 保留原有 8 单位坐标契约，允许连续小数比例；扁平渲染避免聊天重挂。
  visit(layout, { x: 0, y: 0, width: 8, height: 8 }, "");
}

export function getSplitLayoutCells(layout: SplitLayout): ReadonlyMap<string, SplitLayoutCell> {
  const cells = new Map<string, SplitLayoutCell>();
  visitSplitLayout(
    layout,
    (key, cell) => cells.set(key, cell),
    () => undefined,
  );
  return cells;
}

export function getSplitLayoutDividers(layout: SplitLayout): readonly SplitLayoutDivider[] {
  const dividers: SplitLayoutDivider[] = [];
  visitSplitLayout(
    layout,
    () => undefined,
    (divider) => dividers.push(divider),
  );
  return dividers;
}

// 匹配和帮助面板共用方向映射，修改按键时避免显示内容与实际行为脱节。
export const SPLIT_SHORTCUTS = [
  { direction: "up", key: "ArrowUp", label: "↑" },
  { direction: "down", key: "ArrowDown", label: "↓" },
  { direction: "left", key: "ArrowLeft", label: "←" },
  { direction: "right", key: "ArrowRight", label: "→" },
] as const;

export function getSplitShortcutDisplayKeys(
  direction: SplitDirection,
  mac: boolean,
): readonly string[] {
  const shortcut = SPLIT_SHORTCUTS.find((candidate) => candidate.direction === direction);
  if (shortcut === undefined) return [];
  return [mac ? "⌥" : "Alt", "Shift", shortcut.label];
}

export function getSplitShortcutDirection(
  event: Pick<
    KeyboardEvent,
    | "altKey"
    | "ctrlKey"
    | "metaKey"
    | "shiftKey"
    | "key"
    | "defaultPrevented"
    | "isComposing"
    | "repeat"
  >,
): SplitDirection | undefined {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    !event.altKey ||
    !event.shiftKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return undefined;
  // 两端和所有系统共用组合，保留浏览器的 Cmd/Ctrl+Alt+方向键及 Alt+D 默认行为。
  return SPLIT_SHORTCUTS.find((shortcut) => shortcut.key === event.key)?.direction;
}
