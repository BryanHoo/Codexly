import { lazy, Suspense, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import {
  MAX_SPLIT_PANES,
  splitPaneKey,
  type SplitPaneIdentity,
} from "@codexly/frontend-core/split-workspace";
import {
  getSplitShortcutDirection,
  type SplitDirection,
} from "@codexly/frontend-core/split-layout";
import { ContextMenu, ContextMenuTrigger } from "./context-menu.js";
import { isSplitBlankPoint } from "./split-workspace-hit-test.js";
import type SplitWorkspaceMenuContent from "./split-workspace-menu-content.js";

type SplitActions = Readonly<{
  enabled: boolean;
  panes: readonly SplitPaneIdentity[];
  activeKey: string | undefined;
  focus: (pane: SplitPaneIdentity) => void;
  split: (pane: SplitPaneIdentity, direction: SplitDirection) => void;
}>;

// 菜单内容按需加载；预热只加载代码，不创建额外窗口或任务订阅。
let menuModule: Promise<{ default: typeof SplitWorkspaceMenuContent }> | undefined;
function loadMenu() {
  menuModule ??= import("./split-workspace-menu-content.js");
  return menuModule;
}
const MenuContent = lazy(loadMenu);

export function SplitPaneMenu({
  pane,
  labels,
  children,
  workspace,
}: Readonly<{
  pane: SplitPaneIdentity;
  labels: Record<SplitDirection, string> & { limit: string };
  children: ReactNode;
  workspace: SplitActions;
}>) {
  const [blank, setBlank] = useState(false);
  const [open, setOpen] = useState(false);
  const limit = workspace.panes.length >= MAX_SPLIT_PANES;
  return (
    <ContextMenu modal={false} onOpenChange={setOpen}>
      <ContextMenuTrigger
        asChild
        style={{ WebkitTouchCallout: "default" }}
        disabled={!workspace.enabled || !blank}
        onPointerEnter={() => {
          if (workspace.enabled)
            void loadMenu().catch(() => {
              menuModule = undefined;
            });
        }}
        onPointerDownCapture={(event) => {
          // 在 contextmenu 到达前切换 Trigger 的可用状态，保留正文和输入框的原生菜单。
          if (!workspace.enabled || (event.button !== 2 && event.pointerType !== "touch")) return;
          setBlank(isSplitBlankPoint(event.target, event.clientX, event.clientY));
        }}
        onContextMenu={(event) => {
          // 子组件菜单、文本选择和表单控件继续处理原有右键；仅空白处打开分屏菜单。
          if (event.defaultPrevented || !blank) return;
          workspace.focus(pane);
        }}
      >
        {children}
      </ContextMenuTrigger>
      {open ? (
        <Suspense fallback={null}>
          <MenuContent
            labels={labels}
            limit={limit}
            onSplit={(direction) => {
              workspace.split(pane, direction);
            }}
          />
        </Suspense>
      ) : null}
    </ContextMenu>
  );
}

export function SplitWorkspaceShortcuts({ workspace }: Readonly<{ workspace: SplitActions }>) {
  const invoke = useEffectEvent((direction: SplitDirection) => {
    if (!workspace.enabled || workspace.panes.length >= MAX_SPLIT_PANES) return false;
    const pane = workspace.panes.find((pane) => splitPaneKey(pane) === workspace.activeKey);
    if (pane === undefined) return false;
    workspace.split(pane, direction);
    return true;
  });
  useEffect(() => {
    const mac = /mac/i.test(navigator.platform);
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = getSplitShortcutDirection(event, mac);
      if (direction === undefined) return;
      // 模态对话框及已打开菜单拥有键盘焦点，不在其背后修改工作区布局。
      if (
        [
          ...document.querySelectorAll(
            '[role="dialog"], [role="alertdialog"], [role="menu"], dialog[open]',
          ),
        ].some((element) => element.getClientRects().length > 0)
      )
        return;
      if (!invoke(direction)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // 全工作区只挂载一次监听；Effect Event 读取最新焦点，不随消息更新重复订阅。
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
  return null;
}
