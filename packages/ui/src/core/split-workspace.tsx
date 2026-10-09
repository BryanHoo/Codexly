import {
  Activity,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  addSplitPane,
  MAX_SPLIT_PANES,
  removeSplitPane,
  replaceSplitPane,
  splitPaneKey,
  type SplitPaneIdentity,
} from "@codexly/frontend-core/split-workspace";

const mobileQuery = "(max-width: 760px), (hover: none) and (pointer: coarse)";
function subscribeMobile(listener: () => void) {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", listener);
  return () => {
    query.removeEventListener("change", listener);
  };
}
const getMobile = () => window.matchMedia(mobileQuery).matches;
const getServerMobile = () => false;

type Workspace = Readonly<{
  enabled: boolean;
  panes: readonly SplitPaneIdentity[];
  activeKey: string | undefined;
  add: (pane: SplitPaneIdentity) => void;
  close: (pane: SplitPaneIdentity) => void;
  focus: (pane: SplitPaneIdentity) => void;
  replace: (previous: SplitPaneIdentity, next: SplitPaneIdentity) => void;
  solo: (pane: SplitPaneIdentity) => void;
}>;
const SplitWorkspaceContext = createContext<Workspace | null>(null);
export const useSplitWorkspace = () => useContext(SplitWorkspaceContext);

export function SplitWorkspaceProvider({
  children,
  current,
  routeKey,
  desktop = false,
}: Readonly<{
  children: ReactNode;
  current: SplitPaneIdentity | undefined;
  routeKey: string;
  desktop?: boolean;
}>) {
  const mobile = useSyncExternalStore(subscribeMobile, getMobile, getServerMobile);
  const [selection, setSelection] = useState(() => ({
    routeKey,
    panes: current === undefined ? [] : ([current] as readonly SplitPaneIdentity[]),
    activeKey: current === undefined ? undefined : splitPaneKey(current),
  }));
  // 外部导航开始新工作区；分屏内部的焦点切换不修改路由或重挂聊天。
  if (selection.routeKey !== routeKey) {
    setSelection({
      routeKey,
      panes: current === undefined ? [] : [current],
      activeKey: current === undefined ? undefined : splitPaneKey(current),
    });
  }
  const enabled = desktop || !mobile;
  const add = useCallback(
    (pane: SplitPaneIdentity) => {
      if (!enabled) return;
      setSelection((previous) => {
        const panes = addSplitPane(previous.panes, pane);
        return panes === previous.panes
          ? previous
          : { ...previous, panes, activeKey: splitPaneKey(pane) };
      });
    },
    [enabled],
  );
  const close = useCallback((pane: SplitPaneIdentity) => {
    setSelection((previous) => {
      const panes = removeSplitPane(previous.panes, pane);
      return {
        ...previous,
        panes,
        activeKey:
          previous.activeKey === splitPaneKey(pane)
            ? panes[0] === undefined
              ? undefined
              : splitPaneKey(panes[0])
            : previous.activeKey,
      };
    });
  }, []);
  const focus = useCallback((pane: SplitPaneIdentity) => {
    setSelection((previous) => {
      const key = splitPaneKey(pane);
      if (previous.activeKey === key || !previous.panes.some((item) => splitPaneKey(item) === key))
        return previous;
      return { ...previous, activeKey: key };
    });
  }, []);
  const solo = useCallback((pane: SplitPaneIdentity) => {
    setSelection((previous) => ({ ...previous, panes: [pane], activeKey: splitPaneKey(pane) }));
  }, []);
  const replace = useCallback((previous: SplitPaneIdentity, next: SplitPaneIdentity) => {
    setSelection((selection) => {
      // 请求可能在关闭窗口后返回，不能让迟到结果把活动身份指向不存在的窗口。
      if (!selection.panes.some((pane) => splitPaneKey(pane) === splitPaneKey(previous)))
        return selection;
      const panes = replaceSplitPane(selection.panes, previous, next);
      const activeKey = splitPaneKey(next);
      return panes === selection.panes && activeKey === selection.activeKey
        ? selection
        : { ...selection, panes, activeKey };
    });
  }, []);
  const value = useMemo(
    () => ({
      enabled,
      panes: selection.panes,
      activeKey: selection.activeKey,
      add,
      close,
      focus,
      solo,
      replace,
    }),
    [enabled, selection.panes, selection.activeKey, add, close, focus, solo, replace],
  );
  return <SplitWorkspaceContext value={value}>{children}</SplitWorkspaceContext>;
}

export function getSplitAction(workspace: Workspace | null, pane: SplitPaneIdentity) {
  if (!workspace?.enabled) return null;
  if (workspace.panes.some((item) => splitPaneKey(item) === splitPaneKey(pane))) return "added";
  return workspace.panes.length >= MAX_SPLIT_PANES ? "limit" : "add";
}

export const SplitPaneContext = createContext<Readonly<{
  pane: SplitPaneIdentity;
  active: boolean;
  multiple: boolean;
  toggleSidebar: () => void;
  sidebarOpen: boolean;
}> | null>(null);

export function SplitWorkspaceGrid({
  children,
  label,
  toggleSidebar,
  sidebarOpen,
}: Readonly<{
  children: (pane: SplitPaneIdentity) => ReactNode;
  label: string;
  toggleSidebar: () => void;
  sidebarOpen: boolean;
}>) {
  const workspace = useSplitWorkspace();
  if (workspace === null) throw new Error("Missing split workspace provider");
  const multiple = workspace.enabled && workspace.panes.length > 1;
  return (
    <div
      className="split-workspace"
      data-multiple={multiple}
      data-count={multiple ? workspace.panes.length : 1}
      aria-label={label}
    >
      {workspace.panes.map((pane) => {
        const key = splitPaneKey(pane);
        const active = key === workspace.activeKey;
        return (
          <Activity key={key} mode={workspace.enabled || active ? "visible" : "hidden"}>
            <section
              className="split-workspace-pane"
              data-split-pane={key}
              data-active={active}
              onPointerDownCapture={() => {
                workspace.focus(pane);
              }}
              onFocusCapture={() => {
                workspace.focus(pane);
              }}
            >
              {/* 身份和父级位置始终稳定，增删相邻窗口不重建输入框或时间线。 */}
              <SplitPaneContext value={{ pane, active, multiple, toggleSidebar, sidebarOpen }}>
                {children(pane)}
              </SplitPaneContext>
            </section>
          </Activity>
        );
      })}
    </div>
  );
}

export function useNavigateSplitTask() {
  const pane = useContext(SplitPaneContext);
  const workspace = useSplitWorkspace();
  const identity = pane?.pane;
  const replace = workspace?.replace;
  return useCallback(
    (projectId: string, taskId: string) => {
      if (identity === undefined || replace === undefined) return false;
      replace(identity, { projectId, taskId });
      return true;
    },
    [identity, replace],
  );
}
