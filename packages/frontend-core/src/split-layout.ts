export type SplitDirection = "up" | "down" | "left" | "right";
export type SplitLayout =
  | string
  | Readonly<{
      axis: "horizontal" | "vertical";
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

type Cell = Readonly<{ x: number; y: number; width: number; height: number }>;
export function getSplitLayoutCells(layout: SplitLayout): ReadonlyMap<string, Cell> {
  const cells = new Map<string, Cell>();
  const visit = (node: SplitLayout, cell: Cell) => {
    if (typeof node === "string") {
      cells.set(node, cell);
      return;
    }
    if (node.axis === "horizontal") {
      const width = cell.width / 2;
      visit(node.first, { ...cell, width });
      visit(node.second, { ...cell, x: cell.x + width, width });
    } else {
      const height = cell.height / 2;
      visit(node.first, { ...cell, height });
      visit(node.second, { ...cell, y: cell.y + height, height });
    }
  };
  // 最多四屏、三层切分，8 格足以精确表示所有半分位置；扁平渲染避免聊天重挂。
  visit(layout, { x: 0, y: 0, width: 8, height: 8 });
  return cells;
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
