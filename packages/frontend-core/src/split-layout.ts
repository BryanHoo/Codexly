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
  // 旧入口继续使用原来的二屏并排、三屏左侧通高、四屏田字布局。
  if (three === undefined) return { axis: "horizontal", first: one, second: two };
  return {
    axis: "horizontal",
    first: four === undefined ? one : { axis: "vertical", first: one, second: three },
    second: { axis: "vertical", first: two, second: four ?? three },
  };
}

export function splitLayout(
  layout: SplitLayout,
  target: string,
  added: string,
  direction: SplitDirection,
): SplitLayout {
  if (typeof layout === "string") {
    if (layout !== target) return layout;
    const before = direction === "left" || direction === "up";
    return {
      axis: direction === "left" || direction === "right" ? "horizontal" : "vertical",
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
  if (typeof layout === "string") return map(layout);
  const first = remapSplitLayout(layout.first, map);
  const second = remapSplitLayout(layout.second, map);
  // 关闭窗口时折叠其父节点，兄弟窗口自动填满释放的区域。
  if (first === undefined) return second;
  if (second === undefined) return first;
  return first === layout.first && second === layout.second ? layout : { ...layout, first, second };
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
  mac: boolean,
): SplitDirection | undefined {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.shiftKey ||
    !event.altKey
  )
    return undefined;
  if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return undefined;
  switch (event.key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    default:
      return undefined;
  }
}
