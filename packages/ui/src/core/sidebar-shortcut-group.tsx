import * as Popover from "radix-ui/popover";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "./button.js";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "./drawer.js";

type GroupProps<T> = Readonly<{
  name: "pinned" | "active";
  title: string;
  summary: ReactNode;
  tasks: readonly T[];
  taskKey: (task: T) => string;
  renderTask: (task: T) => ReactNode;
  limit: number;
  expanded: boolean;
  onToggle: () => void;
  mobile: boolean;
  showAll: string;
  closeLabel: string;
  onNavigate?: (() => void) | undefined;
}>;

function ShortcutList<T>({
  tasks,
  taskKey,
  renderTask,
  onSelect,
}: Pick<GroupProps<T>, "tasks" | "taskKey" | "renderTask"> & { onSelect: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 完整列表仅打开时挂载；大量固定任务使用虚拟行，避免一次创建全部历史节点。
  const virtual = tasks.length > 50;
  const virtualizer = useVirtualizer({
    count: tasks.length,
    enabled: virtual,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 5,
    getItemKey: (index) => {
      const task = tasks[index];
      return task === undefined ? index : taskKey(task);
    },
  });
  return (
    <div
      ref={scrollRef}
      className="min-h-0 overflow-y-auto overscroll-contain"
      style={{ maxHeight: "min(60dvh, 480px)" }}
      onClick={(event) => {
        // 仅普通任务导航关闭浮层；菜单、复制链接及修饰键打开新页保持原有行为。
        if (
          event.target instanceof Element &&
          event.target.closest("a") &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        )
          onSelect();
      }}
    >
      {virtual ? (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((row) => {
            const task = tasks[row.index];
            return (
              <div
                key={row.key}
                style={{
                  position: "absolute",
                  width: "100%",
                  height: 32,
                  transform: `translateY(${String(row.start)}px)`,
                }}
              >
                {task === undefined ? null : renderTask(task)}
              </div>
            );
          })}
        </div>
      ) : (
        tasks.map((task) => <div key={taskKey(task)}>{renderTask(task)}</div>)
      )}
    </div>
  );
}

export function SidebarShortcutGroup<T>({
  name,
  title,
  summary,
  tasks,
  taskKey,
  renderTask,
  limit,
  expanded,
  onToggle,
  mobile,
  showAll,
  closeLabel,
  onNavigate,
}: GroupProps<T>) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = useRef(false);
  const [open, setOpen] = useState(false);
  const changeOpen = (next: boolean) => {
    if (next) selected.current = false;
    setOpen(next);
  };
  const list = () => (
    <ShortcutList
      tasks={tasks}
      taskKey={taskKey}
      renderTask={renderTask}
      onSelect={() => {
        selected.current = true;
        setOpen(false);
        onNavigate?.();
      }}
    />
  );
  const restoreFocus = (event: Event) => {
    // 导航后不把焦点还给旧侧栏，Escape/关闭按钮则恢复到仍存在的计数入口。
    if (selected.current) event.preventDefault();
    else if (mobile) {
      event.preventDefault();
      triggerRef.current?.focus();
    }
  };
  return (
    <Popover.Root open={open && !mobile} onOpenChange={changeOpen}>
      <section
        data-sidebar-shortcut-group={name}
        aria-labelledby={`${id}-title`}
        className="min-w-0 shrink-0"
      >
        <div className="flex h-7 min-w-0 items-center px-1">
          <h2 id={`${id}-title`} className="flex min-w-0 flex-1">
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                // 自动限高仍保留手动查看入口，不把窗口收缩误写成用户折叠偏好。
                if (expanded && limit === 0) changeOpen(true);
                else onToggle();
              }}
              aria-expanded={expanded && limit > 0}
              aria-controls={`${id}-preview`}
              className="h-7 w-full justify-start gap-1 px-1 text-meta font-semibold text-muted-foreground"
            >
              {expanded && limit > 0 ? (
                <ChevronDown aria-hidden="true" className="size-3" />
              ) : (
                <ChevronRight aria-hidden="true" className="size-3" />
              )}
              <span className="truncate">{title}</span>
            </Button>
          </h2>
          <Popover.Trigger
            asChild
            onClick={
              mobile
                ? (event) => {
                    event.preventDefault();
                    changeOpen(true);
                  }
                : undefined
            }
          >
            <Button
              ref={triggerRef}
              variant="ghost"
              type="button"
              aria-label={`${title}：${showAll}`}
              aria-haspopup="dialog"
              className="h-7 shrink-0 gap-1 px-1 text-caption text-subtle-foreground"
            >
              {summary}
            </Button>
          </Popover.Trigger>
        </div>
        <div id={`${id}-preview`} className="flex flex-col" hidden={limit === 0}>
          {tasks.slice(0, limit).map((task) => (
            <div key={taskKey(task)}>{renderTask(task)}</div>
          ))}
          {limit > 0 && limit < tasks.length ? (
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                changeOpen(true);
              }}
              className="h-6 w-full justify-start px-2 text-caption text-subtle-foreground"
            >
              {showAll}
            </Button>
          ) : null}
        </div>
      </section>
      {open && !mobile ? (
        <Popover.Portal>
          <Popover.Content
            align="start"
            side="right"
            sideOffset={12}
            collisionPadding={8}
            aria-label={`${title}：${showAll}`}
            onCloseAutoFocus={restoreFocus}
            className="z-50 flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-16px)] min-w-0 flex-col overflow-hidden rounded-surface border border-separator-strong bg-raised p-2 text-foreground shadow-floating outline-none"
          >
            <h3 className="shrink-0 px-2 pb-2 text-body-small font-semibold">
              {title}{" "}
              <span className="text-caption font-normal text-subtle-foreground">{summary}</span>
            </h3>
            {list()}
          </Popover.Content>
        </Popover.Portal>
      ) : null}
      {mobile ? (
        <Drawer swipeDirection="left" showSwipeHandle open={open} onOpenChange={changeOpen}>
          <DrawerContent
            closeLabel={closeLabel}
            aria-describedby={undefined}
            onCloseAutoFocus={restoreFocus}
          >
            <DrawerHeader>
              <DrawerTitle>
                {title}{" "}
                <span className="text-caption font-normal text-subtle-foreground">{summary}</span>
              </DrawerTitle>
            </DrawerHeader>
            {open ? <div className="min-h-0 px-2">{list()}</div> : null}
          </DrawerContent>
        </Drawer>
      ) : null}
    </Popover.Root>
  );
}
