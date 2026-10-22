import {
  createPresetSplitLayout,
  type SplitLayoutPreset,
  type SplitPaneCount,
  type SplitWorkspaceSize,
} from "@codexly/frontend-core/split-layout-presets";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import type { SplitWorkspaceSelection } from "@codexly/frontend-core/split-workspace-selection";
import {
  MAX_SPLIT_PANES,
  splitPaneKey,
  type SplitPaneIdentity,
} from "@codexly/frontend-core/split-workspace";
import {
  createSplitLayout,
  getSplitShortcutDirection,
  remapSplitLayout,
  type SplitDirection,
} from "@codexly/frontend-core/split-layout";
import { ContextMenu, ContextMenuTrigger } from "./context-menu.js";
import { isSplitBlankPoint } from "./split-workspace-hit-test.js";
import type SplitWorkspaceMenuContent from "./split-workspace-menu-content.js";

export type SplitWorkspaceActions = Readonly<{
  applyPreset: (count: SplitPaneCount, preset: SplitLayoutPreset, size: SplitWorkspaceSize) => void;
  resize: (path: string, ratio: number) => void;
  swap: (source: string, target: string) => void;
  split: (pane: SplitPaneIdentity, direction: SplitDirection) => void;
  add: (pane: SplitPaneIdentity) => void;
  close: (pane: SplitPaneIdentity) => void;
  dismiss: (pane: SplitPaneIdentity) => boolean;
  focus: (pane: SplitPaneIdentity) => void;
  select: (pane: SplitPaneIdentity) => boolean;
  replace: (previous: SplitPaneIdentity, next: SplitPaneIdentity) => void;
  solo: (pane: SplitPaneIdentity) => void;
}>;

export function createSplitDraft(
  projectId: string,
): Extract<SplitPaneIdentity, { draftId: string }> {
  const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
    value.toString(16).padStart(8, "0"),
  ).join("");
  return { projectId, draftId: `split-draft:${id}` };
}

export function useSplitPaneSwap(
  enabled: boolean,
  setSelection: Dispatch<SetStateAction<SplitWorkspaceSelection>>,
) {
  return useCallback<SplitWorkspaceActions["swap"]>(
    (source, target) => {
      if (!enabled || source === target) return;
      setSelection((previous) => {
        const keys = previous.panes.map(splitPaneKey);
        if (!keys.includes(source) || !keys.includes(target)) return previous;
        // 仅交换布局树的叶子身份，保留切分比例、窗口顺序、输入框挂载及活动任务。
        return {
          ...previous,
          layout: remapSplitLayout(previous.layout ?? createSplitLayout(keys), (key) =>
            key === source ? target : key === target ? source : key,
          ),
        };
      });
    },
    [enabled, setSelection],
  );
}

export function useSplitLayoutPreset(
  enabled: boolean,
  setSelection: Dispatch<SetStateAction<SplitWorkspaceSelection>>,
  createSplitDraft: (projectId: string) => SplitPaneIdentity,
) {
  return useCallback<SplitWorkspaceActions["applyPreset"]>(
    (count, preset, size) => {
      if (!enabled) return;
      setSelection((previous) => {
        const current = previous.panes[0];
        // 仅单窗口可用，检查最新状态，避免菜单迟到事件覆盖已经打开的分屏及草稿。
        if (current === undefined || previous.panes.length !== 1 || ![2, 3, 4].includes(count))
          return previous;
        const panes = [current];
        while (panes.length < count) panes.push(createSplitDraft(current.projectId));
        // 一次提交所有窗口和布局，保留当前会话身份、输入内容及活动焦点。
        return {
          ...previous,
          panes,
          activeKey: splitPaneKey(current),
          layout: createPresetSplitLayout(panes.map(splitPaneKey), preset, size),
        };
      });
    },
    [enabled, setSelection, createSplitDraft],
  );
}

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
