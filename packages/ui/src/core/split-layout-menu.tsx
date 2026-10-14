import * as Popover from "radix-ui/popover";
import { LayoutTemplate, Scan } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { getSplitLayoutCells } from "@codexly/frontend-core/split-layout";
import {
  createPresetSplitLayout,
  splitLayoutPresetGroups,
  type SplitLayoutPreset,
  type SplitPaneCount,
} from "@codexly/frontend-core/split-layout-presets";
import { Button } from "./button.js";
import {
  SplitPaneContext,
  useSplitWorkspaceActions,
  useSplitWorkspaceState,
} from "./split-workspace.js";

type LayoutMenuLabels = Record<SplitLayoutPreset, string> &
  Readonly<{
    chooseLayout: string;
    twoPanes: string;
    threePanes: string;
    fourPanes: string;
    presetHint: string;
    autoHint: string;
  }>;

function LayoutPreview({
  count,
  preset,
}: Readonly<{ count: SplitPaneCount; preset: SplitLayoutPreset }>) {
  if (preset === "auto")
    return <Scan aria-hidden="true" className="h-7 w-12 text-muted-foreground" />;
  const layout = createPresetSplitLayout(
    ["current", "second", "third", "fourth"].slice(0, count),
    preset,
    { width: 1000, height: 700 },
  );
  if (layout === undefined) return null;
  return (
    <svg aria-hidden="true" viewBox="0 0 56 32" className="h-7 w-12" fill="none">
      {[...getSplitLayoutCells(layout)].map(([key, cell]) => (
        <rect
          key={key}
          x={cell.x * 7 + 1}
          y={cell.y * 4 + 1}
          width={cell.width * 7 - 2}
          height={cell.height * 4 - 2}
          rx="1.5"
          fill="currentColor"
          fillOpacity={key === "current" ? 0.24 : 0.06}
          stroke="currentColor"
          strokeOpacity={key === "current" ? 0.85 : 0.4}
        />
      ))}
    </svg>
  );
}

export function SplitLayoutMenu({ labels }: Readonly<{ labels: LayoutMenuLabels }>) {
  const pane = useContext(SplitPaneContext);
  // 分屏中的每个标题栏不订阅全局布局，避免拖动或聚焦其他窗口引发无用重渲染。
  const workspace = useSplitWorkspaceState(!pane?.multiple);
  const actions = useSplitWorkspaceActions();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverOpened = useRef(false);
  const selected = useRef(false);
  const available = workspace?.enabled && workspace.panes.length === 1 && actions !== null;
  const clearTimer = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => {
    if (!available) setOpen(false);
    // 移动端切换或其他入口触发分屏时同样取消悬停任务，恢复单窗不带回旧菜单。
    return () => {
      clearTimeout(timer.current);
    };
  }, [available]);
  // 与现有 Web 移动端规则保持一致；已分屏时只保留原有的窗口关闭/独显入口。
  if (!available) return null;
  const closeOnLeave = () => {
    clearTimer();
    if (hoverOpened.current)
      timer.current = setTimeout(() => {
        setOpen(false);
      }, 200);
  };
  return (
    <Popover.Root
      modal={false}
      open={open}
      onOpenChange={(next) => {
        clearTimer();
        if (next) {
          hoverOpened.current = false;
          selected.current = false;
        }
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <Button
          ref={triggerRef}
          aria-label={labels.chooseLayout}
          aria-haspopup="menu"
          size="icon-sm"
          variant="ghost"
          type="button"
          onPointerEnter={(event) => {
            if (event.pointerType === "touch") return;
            clearTimer();
            if (open) return;
            // 短延迟避免鼠标经过顶部时误展开；触摸与键盘仍使用弹层的主动打开行为。
            timer.current = setTimeout(() => {
              hoverOpened.current = true;
              selected.current = false;
              setOpen(true);
            }, 120);
          }}
          onPointerLeave={closeOnLeave}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            clearTimer();
            hoverOpened.current = false;
            selected.current = false;
            setOpen(true);
            const items =
              contentRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
            if (items !== undefined) items[event.key === "ArrowUp" ? items.length - 1 : 0]?.focus();
          }}
          onClick={(event) => {
            clearTimer();
            if (open && hoverOpened.current) {
              // 悬停展开后点击固定菜单，避免第一次点击被默认切换行为关闭。
              event.preventDefault();
              hoverOpened.current = false;
              event.currentTarget.focus();
            }
          }}
        >
          <LayoutTemplate aria-hidden="true" className="size-3.5" />
        </Button>
      </Popover.Trigger>
      {open ? (
        <Popover.Portal>
          <Popover.Content
            ref={contentRef}
            align="end"
            role="menu"
            collisionPadding={8}
            aria-label={labels.chooseLayout}
            className="z-50 w-72 max-w-[calc(100vw-16px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-surface bg-raised p-2 text-foreground shadow-floating outline-none"
            sideOffset={6}
            onPointerEnter={clearTimer}
            onPointerLeave={closeOnLeave}
            onOpenAutoFocus={(event) => {
              // 悬停只展示选项，不抢走正在输入的 Composer 焦点。
              if (hoverOpened.current) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              // 选中后入口会隐藏；不把焦点恢复给即将卸载的按钮或非活动窗口。
              // 其他关闭原因交给弹层处理，保留 Escape 恢复入口及点击外部时的自然焦点。
              if (selected.current || hoverOpened.current) event.preventDefault();
            }}
            onKeyDown={(event) => {
              // 布局按钮按视觉阅读顺序参与键盘导航，Tab 仍保持浏览器原生焦点顺序。
              const step =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!step && event.key !== "Home" && event.key !== "End") return;
              const items = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
              ];
              if (items.length === 0) return;
              const current = items.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (current + step + items.length) % items.length;
              event.preventDefault();
              items[next]?.focus();
            }}
          >
            {splitLayoutPresetGroups.map(({ count, presets }) => (
              <div
                key={count}
                role="group"
                aria-label={
                  labels[count === 2 ? "twoPanes" : count === 3 ? "threePanes" : "fourPanes"]
                }
              >
                <div className="px-1 py-1 text-caption font-medium text-muted-foreground">
                  {labels[count === 2 ? "twoPanes" : count === 3 ? "threePanes" : "fourPanes"]}
                </div>
                <div className="grid grid-cols-3 gap-1 pb-1">
                  {presets.map((preset) => (
                    <Button
                      key={preset}
                      role="menuitem"
                      variant="ghost"
                      size="embedded"
                      type="button"
                      aria-label={`${labels[count === 2 ? "twoPanes" : count === 3 ? "threePanes" : "fourPanes"]} · ${labels[preset]}`}
                      className="rounded-control flex-col gap-1 px-1 py-2 text-label hover:text-brand focus-visible:bg-control-hover focus-visible:text-brand"
                      title={preset === "auto" ? labels.autoHint : undefined}
                      onClick={() => {
                        selected.current = true;
                        clearTimer();
                        // Portal 内菜单不属于中栏 DOM，必须由入口向上找到实际工作区并仅测量一次。
                        const bounds = triggerRef.current
                          ?.closest(".split-workspace")
                          ?.getBoundingClientRect();
                        actions.applyPreset(count, preset, {
                          width: bounds?.width ?? 0,
                          height: bounds?.height ?? 0,
                        });
                        setOpen(false);
                      }}
                    >
                      <LayoutPreview count={count} preset={preset} />
                      <span>{labels[preset]}</span>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
            <p className="mt-1 border-t border-separator px-1 pt-2 text-caption text-muted-foreground">
              {labels.presetHint}
            </p>
          </Popover.Content>
        </Popover.Portal>
      ) : null}
    </Popover.Root>
  );
}
