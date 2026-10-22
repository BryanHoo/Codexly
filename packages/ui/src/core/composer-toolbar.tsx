import * as Popover from "radix-ui/popover";
import { SlidersHorizontal } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

type ToolbarItem = Readonly<{
  id: string;
  label: string;
  control: ReactNode;
  priority?: number;
  trailing?: boolean;
  pinned?: boolean;
}>;

/** 两端共用自适应工具栏；items 保留原始显示顺序，priority 仅决定收起先后。 */
export function ComposerToolbar({
  leading,
  model,
  items,
  actions,
  moreLabel,
  title,
}: Readonly<{
  leading: ReactNode;
  model: ReactNode;
  items: readonly ToolbarItem[];
  actions: ReactNode;
  moreLabel: string;
  title: string;
}>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hiddenIds, setHiddenIds] = useState<readonly string[]>([]);
  const [open, setOpen] = useState(false);
  const itemKeys = items
    .map(
      (item) =>
        `${item.id}:${String(item.priority ?? 0)}:${String(item.pinned ?? false)}:${String(item.trailing ?? false)}`,
    )
    .join(",");

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const leadingElement = root.querySelector<HTMLElement>("[data-composer-leading]");
    const actionsElement = root.querySelector<HTMLElement>("[data-composer-actions]");
    if (!leadingElement || !actionsElement) return;
    const slots = [...root.querySelectorAll<HTMLElement>("[data-composer-option]")];
    const measure = () => {
      const styles = getComputedStyle(root);
      const gap = Number.parseFloat(styles.columnGap) || 0;
      const width =
        root.clientWidth -
        Number.parseFloat(styles.paddingLeft) -
        Number.parseFloat(styles.paddingRight);
      // 为常用模型入口预留完整标签宽度；极窄时仅模型标签可截断，发送始终可见。
      const fixedWidth = leadingElement.offsetWidth + actionsElement.offsetWidth + 144 + gap * 2;
      const collapsibleSlots = slots
        .filter((slot) => slot.offsetWidth > 0 && slot.dataset["composerPinned"] !== "true")
        .sort(
          (left, right) =>
            Number(left.dataset["composerPriority"] ?? 0) -
            Number(right.dataset["composerPriority"] ?? 0),
        );
      let used = fixedWidth + slots.reduce((sum, slot) => sum + slot.offsetWidth + gap, 0);
      const nextHidden: string[] = [];
      if (used > width) {
        // 收起优先级与显示顺序独立；先预留“更多”入口，避免按钮出现后再次挤出内容。
        used += 32 + gap;
        for (const slot of collapsibleSlots) {
          if (used <= width) break;
          const id = slot.dataset["composerOption"];
          if (id) nextHidden.push(id);
          used -= slot.offsetWidth + gap;
        }
      }
      setHiddenIds((previous) =>
        previous.join(",") === nextHidden.join(",") ? previous : nextHidden,
      );
      if (nextHidden.length === 0) setOpen(false);
    };
    measure();
    // 监听容器及控件尺寸即可响应分栏拖动、语言/模型标签变化，无轮询或全局 resize 监听。
    const observer = new ResizeObserver(measure);
    for (const element of [root, leadingElement, actionsElement, ...slots])
      observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [itemKeys]);

  const hiddenItems = items.filter((item) => hiddenIds.includes(item.id));
  const renderItem = (item: ToolbarItem) => {
    const hidden = hiddenIds.includes(item.id);
    return (
      <div
        aria-hidden={hidden || undefined}
        className="flex w-max shrink-0 items-center gap-1"
        data-composer-option={item.id}
        data-composer-priority={item.priority ?? 0}
        data-composer-pinned={item.pinned ?? undefined}
        inert={hidden}
        key={item.id}
        // 收起后仍保留自然尺寸供测量，但脱离文档流及无障碍树，不占输入框空间。
        style={
          hidden
            ? {
                position: "fixed",
                left: 0,
                top: 0,
                visibility: "hidden",
                pointerEvents: "none",
              }
            : undefined
        }
      >
        {item.control}
      </div>
    );
  };
  return (
    <div
      className="composer-toolbar relative flex min-h-10 min-w-0 items-center gap-1 px-2 pb-2"
      ref={rootRef}
    >
      <div className="flex shrink-0 items-center" data-composer-leading="">
        {leading}
      </div>
      {items.filter((item) => !item.trailing).map(renderItem)}
      {hiddenItems.length > 0 ? (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Popover.Trigger asChild>
                <Button
                  aria-label={moreLabel}
                  className="size-8 shrink-0 text-muted-foreground data-[state=open]:bg-control-hover data-[state=open]:text-foreground"
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <SlidersHorizontal aria-hidden="true" className="size-4" />
                </Button>
              </Popover.Trigger>
            </TooltipTrigger>
            <TooltipContent>{moreLabel}</TooltipContent>
          </Tooltip>
          <Popover.Portal>
            <Popover.Content
              align="end"
              aria-label={title}
              className="z-50 w-60 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-surface border border-separator bg-raised p-1.5 text-foreground shadow-floating outline-none"
              collisionPadding={8}
              side="top"
              sideOffset={6}
              style={{ maxHeight: "var(--radix-popover-content-available-height)" }}
            >
              <div className="mb-1 border-b border-separator px-1.5 pb-1.5 pt-0.5 text-caption font-medium text-muted-foreground">
                {title}
              </div>
              {hiddenItems.map((item) => (
                <div
                  className="flex min-h-7 items-center justify-between gap-2 px-1.5 py-0.5"
                  key={item.id}
                >
                  <span className="shrink-0 text-caption text-muted-foreground">{item.label}</span>
                  <div className="flex min-w-0 items-center justify-end gap-1 [&_button]:h-6 [&_button]:gap-1 [&_button]:px-1.5 [&_button]:text-caption [&_svg]:size-3">
                    {item.control}
                  </div>
                </div>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
      {/* 模型、思考量与发送保持原有的右侧分组，隐藏其他配置也不改变字段顺序。 */}
      <div className="ml-auto flex min-w-0 items-center gap-1" data-composer-trailing="">
        <div className="min-w-0 max-w-36 shrink [&>button]:max-w-full" data-composer-model="">
          {model}
        </div>
        {items.filter((item) => item.trailing).map(renderItem)}
        <div className="flex shrink-0 items-center gap-1" data-composer-actions="">
          {actions}
        </div>
      </div>
    </div>
  );
}
