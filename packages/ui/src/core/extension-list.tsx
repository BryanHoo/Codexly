import { useVirtualizer } from "@tanstack/react-virtual";
import {
  cloneElement,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ComponentPropsWithRef,
} from "react";
type ListItem = Readonly<{ id: string; scope?: string }>;

type RowProps = ComponentPropsWithRef<"li"> & { "data-index"?: number };

type Props<Item extends ListItem> = Readonly<{
  items: readonly Item[];
  renderItem: (item: Item) => ReactElement<RowProps>;
}>;

/** 小目录直接展示；大目录只挂载视口附近的行，避免大量 Tooltip 和开关同时初始化。 */
export function ExtensionList<Item extends ListItem>(props: Props<Item>) {
  return props.items.length > 40 ? (
    <VirtualExtensionList {...props} />
  ) : (
    <ul className="extension-list">{props.items.map(props.renderItem)}</ul>
  );
}

function VirtualExtensionList<Item extends ListItem>({ items, renderItem }: Props<Item>) {
  const list = useRef<HTMLUListElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => list.current?.closest<HTMLElement>(".extension-center") ?? null,
    getItemKey: (index) => {
      const item = items[index];
      return item ? `${item.id}:${item.scope ?? "global"}` : index;
    },
    estimateSize: () => 100,
    overscan: 5,
    scrollMargin,
    initialRect: { width: 600, height: 600 },
  });
  useLayoutEffect(() => {
    const element = list.current;
    const root = element?.closest<HTMLElement>(".extension-center");
    if (!element || !root) return;
    const update = () => {
      setScrollMargin(
        element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <ul
      ref={list}
      className="extension-list"
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const item = items[row.index];
        if (!item) return null;
        return cloneElement(renderItem(item), {
          ref: virtualizer.measureElement,
          "data-index": row.index,
          "aria-posinset": row.index + 1,
          "aria-setsize": items.length,
          style: {
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${String(row.start - scrollMargin)}px)`,
          },
        });
      })}
    </ul>
  );
}
