import {
  Activity,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ContextType,
  type ReactNode,
} from "react";
import {
  addSplitPane,
  MAX_SPLIT_PANES,
  ROUTE_SPLIT_DRAFT_ID,
  removeSplitPane,
  replaceSplitPane,
  selectSplitTask,
  splitPaneKey,
  type SplitPaneIdentity,
} from "@codexly/frontend-core/split-workspace";
import {
  createSplitLayout,
  getSplitLayoutCells,
  remapSplitLayout,
  resizeSplitLayout,
  splitLayout,
  type SplitDirection,
  type SplitLayout,
} from "@codexly/frontend-core/split-layout";
import { subscribeSplitTaskNavigation } from "@codexly/frontend-core/split-task-navigation";
import { SplitPaneMenu, SplitWorkspaceShortcuts } from "./split-workspace-actions.js";
import { SplitWorkspaceResizers, splitPaneStyle } from "./split-workspace-resizers.js";

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

type WorkspaceState = Readonly<{
  enabled: boolean;
  panes: readonly SplitPaneIdentity[];
  layout: SplitLayout | undefined;
}>;
type WorkspaceActions = Readonly<{
  resize: (path: string, ratio: number) => void;
  split: (pane: SplitPaneIdentity, direction: SplitDirection) => void;
  add: (pane: SplitPaneIdentity) => void;
  close: (pane: SplitPaneIdentity) => void;
  focus: (pane: SplitPaneIdentity) => void;
  select: (pane: SplitPaneIdentity) => boolean;
  replace: (previous: SplitPaneIdentity, next: SplitPaneIdentity) => void;
  solo: (pane: SplitPaneIdentity) => void;
}>;
type Workspace = WorkspaceState & WorkspaceActions & { readonly activeKey: string | undefined };
const SplitWorkspaceStateContext = createContext<WorkspaceState | null>(null);
const SplitWorkspaceActionsContext = createContext<WorkspaceActions | null>(null);
const SplitActivePaneContext = createContext<SplitPaneIdentity | undefined>(undefined);
const UnsubscribedWorkspaceContext = createContext<WorkspaceState | null>(null);
const UnsubscribedActivePaneContext = createContext<SplitPaneIdentity | undefined>(undefined);
export const useSplitWorkspaceActions = () => useContext(SplitWorkspaceActionsContext);
// 窗口内使用自己的身份和 active 状态；只有外层入口需要订阅全局布局及焦点。
export const useSplitWorkspaceState = (subscribe = true) =>
  useContext(subscribe ? SplitWorkspaceStateContext : UnsubscribedWorkspaceContext);
export const useSplitActivePane = (subscribe = true) =>
  useContext(subscribe ? SplitActivePaneContext : UnsubscribedActivePaneContext);
export function useSplitWorkspace(): Workspace | null {
  const state = useSplitWorkspaceState();
  const actions = useSplitWorkspaceActions();
  const activePane = useSplitActivePane();
  return useMemo(
    () =>
      state === null || actions === null
        ? null
        : {
            ...state,
            ...actions,
            activeKey: activePane === undefined ? undefined : splitPaneKey(activePane),
          },
    [state, actions, activePane],
  );
}

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
    layout: undefined as SplitLayout | undefined,
  }));
  // 外部导航开始新工作区；分屏内部的焦点切换不修改路由或重挂聊天。
  if (selection.routeKey !== routeKey) {
    setSelection({
      routeKey,
      panes: current === undefined ? [] : [current],
      activeKey: current === undefined ? undefined : splitPaneKey(current),
      layout: undefined,
    });
  }
  const enabled = desktop || !mobile;
  const selectionRef = useRef(selection);
  useLayoutEffect(() => {
    // 操作读取已提交的最新窗口集合，避免闭包过期，也不因焦点或布局更新改变方法身份。
    selectionRef.current = selection;
  }, [selection]);
  const add = useCallback(
    (pane: SplitPaneIdentity) => {
      if (!enabled) return;
      setSelection((previous) => {
        const panes = addSplitPane(previous.panes, pane);
        return panes === previous.panes
          ? previous
          : {
              ...previous,
              panes,
              activeKey: splitPaneKey(pane),
              layout:
                previous.layout === undefined
                  ? undefined
                  : splitLayout(
                      previous.layout,
                      previous.activeKey ?? splitPaneKey(previous.panes[0] ?? pane),
                      splitPaneKey(pane),
                      "right",
                    ),
            };
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
        layout: remapSplitLayout(previous.layout, (key) =>
          panes.some((item) => splitPaneKey(item) === key) ? key : undefined,
        ),
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
    setSelection((previous) => ({
      ...previous,
      panes: [pane],
      activeKey: splitPaneKey(pane),
      layout: undefined,
    }));
  }, []);
  const select = useCallback(
    (pane: SplitPaneIdentity) => {
      const panes = selectionRef.current.panes;
      const alreadyOpen = panes.some((item) => splitPaneKey(item) === splitPaneKey(pane));
      // 单窗口和移动端继续走普通路由；真正分屏时由工作区接管左栏任务切换。
      if (!alreadyOpen && (!enabled || panes.length < 2)) return false;
      setSelection((previous) => {
        const next = selectSplitTask(previous, pane);
        return next.panes === previous.panes
          ? next
          : {
              ...next,
              layout: remapSplitLayout(previous.layout, (key) =>
                key === previous.activeKey ? splitPaneKey(pane) : key,
              ),
            };
      });
      return true;
    },
    [enabled],
  );
  const selectExternalTask = useEffectEvent((pane: SplitPaneIdentity) => {
    // 通知按点击时的最新焦点选择任务；单窗口和移动端仍由平台路由处理。
    return enabled && selection.panes.length > 1 && select(pane);
  });
  useEffect(() => subscribeSplitTaskNavigation(selectExternalTask), []);
  const replace = useCallback((previous: SplitPaneIdentity, next: SplitPaneIdentity) => {
    setSelection((selection) => {
      // 请求可能在关闭窗口后返回，不能让迟到结果把活动身份指向不存在的窗口。
      if (!selection.panes.some((pane) => splitPaneKey(pane) === splitPaneKey(previous)))
        return selection;
      const panes = replaceSplitPane(selection.panes, previous, next);
      const activeKey = splitPaneKey(next);
      return panes === selection.panes && activeKey === selection.activeKey
        ? selection
        : {
            ...selection,
            panes,
            activeKey,
            layout:
              panes === selection.panes
                ? selection.layout
                : remapSplitLayout(selection.layout, (key) => {
                    if (key !== splitPaneKey(previous)) return key;
                    return selection.panes.some((pane) => splitPaneKey(pane) === activeKey)
                      ? undefined
                      : activeKey;
                  }),
          };
    });
  }, []);
  const split = useCallback(
    (pane: SplitPaneIdentity, direction: SplitDirection) => {
      if (!enabled) return;
      setSelection((previous) => {
        if (
          previous.panes.length >= MAX_SPLIT_PANES ||
          !previous.panes.some((item) => splitPaneKey(item) === splitPaneKey(pane))
        )
          return previous;
        // 只创建客户端草稿；首次发送继续沿用各窗口原有的任务创建与身份替换逻辑。
        const draft = createSplitDraft(pane.projectId);
        const activeKey = splitPaneKey(draft);
        const layout = previous.layout ?? createSplitLayout(previous.panes.map(splitPaneKey));
        if (layout === undefined) return previous;
        return {
          ...previous,
          panes: addSplitPane(previous.panes, draft),
          activeKey,
          layout: splitLayout(layout, splitPaneKey(pane), activeKey, direction),
        };
      });
    },
    [enabled],
  );
  const resize = useCallback((path: string, ratio: number) => {
    setSelection((previous) => {
      const layout = previous.layout ?? createSplitLayout(previous.panes.map(splitPaneKey));
      if (layout === undefined) return previous;
      const next = resizeSplitLayout(layout, path, ratio);
      return next === layout ? previous : { ...previous, layout: next };
    });
  }, []);
  const state = useMemo(
    () => ({
      enabled,
      panes: selection.panes,
      layout: selection.layout,
    }),
    [enabled, selection.panes, selection.layout],
  );
  const actions = useMemo(
    () => ({
      resize,
      split,
      add,
      close,
      focus,
      select,
      solo,
      replace,
    }),
    [resize, split, add, close, focus, select, solo, replace],
  );
  const activePane = selection.panes.find((pane) => splitPaneKey(pane) === selection.activeKey);
  return (
    <SplitWorkspaceActionsContext value={actions}>
      <SplitWorkspaceStateContext value={state}>
        <SplitActivePaneContext value={activePane}>{children}</SplitActivePaneContext>
      </SplitWorkspaceStateContext>
    </SplitWorkspaceActionsContext>
  );
}

export function getSplitAction(
  workspace: Pick<WorkspaceState, "enabled" | "panes"> | null,
  pane: SplitPaneIdentity,
) {
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

function SplitPaneProvider({
  children,
  ...props
}: NonNullable<ContextType<typeof SplitPaneContext>> & {
  children: ReactNode;
}) {
  const { pane, active, multiple, toggleSidebar, sidebarOpen } = props;
  // 每个窗口独立缓存 Context；焦点切换只改变原活动窗口和新活动窗口的值。
  const value = useMemo(
    () => ({ pane, active, multiple, toggleSidebar, sidebarOpen }),
    [pane, active, multiple, toggleSidebar, sidebarOpen],
  );
  return <SplitPaneContext value={value}>{children}</SplitPaneContext>;
}

export function SplitWorkspaceGrid({
  children,
  label,
  toggleSidebar,
  sidebarOpen,
  splitLabels,
}: Readonly<{
  children: (pane: SplitPaneIdentity) => ReactNode;
  label: string;
  toggleSidebar: () => void;
  sidebarOpen: boolean;
  splitLabels: Readonly<
    Record<SplitDirection, string> & { limit: string; resizeWidth?: string; resizeHeight?: string }
  >;
}>) {
  const workspace = useSplitWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  if (workspace === null) throw new Error("Missing split workspace provider");
  const [mounts, setMounts] = useState(() => ({
    panes: workspace.panes,
    keys: workspace.panes.map((_, index) => index),
    nextKey: workspace.panes.length,
  }));
  if (mounts.panes !== workspace.panes) {
    let nextKey = mounts.nextKey;
    // 普通路由切换复用唯一输入框；分屏增删按身份复用，并分配无冲突的挂载 key。
    const keys = workspace.panes.map((pane) => {
      const previousIndex = mounts.panes.findIndex(
        (previous) => splitPaneKey(previous) === splitPaneKey(pane),
      );
      return (
        (mounts.panes.length === 1 && workspace.panes.length === 1
          ? mounts.keys[0]
          : mounts.keys[previousIndex]) ?? nextKey++
      );
    });
    setMounts({ panes: workspace.panes, keys, nextKey });
  }
  const multiple = workspace.enabled && workspace.panes.length > 1;
  const layout = useMemo(
    () => workspace.layout ?? createSplitLayout(workspace.panes.map(splitPaneKey)),
    [workspace.layout, workspace.panes],
  );
  const cells = useMemo(
    () => (layout === undefined ? undefined : getSplitLayoutCells(layout)),
    [layout],
  );
  return (
    <div
      ref={containerRef}
      className="split-workspace"
      data-multiple={multiple}
      data-count={multiple ? workspace.panes.length : 1}
      data-directed={multiple && cells !== undefined}
      aria-label={label}
    >
      <SplitWorkspaceShortcuts workspace={workspace} />
      {workspace.panes.map((pane, index) => {
        const key = splitPaneKey(pane);
        const active = key === workspace.activeKey;
        const cell = multiple ? cells?.get(key) : undefined;
        return (
          <Activity
            key={mounts.keys[index]}
            mode={workspace.enabled || active ? "visible" : "hidden"}
          >
            <SplitPaneMenu pane={pane} labels={splitLabels} workspace={workspace}>
              <section
                className="split-workspace-pane"
                data-split-pane={key}
                data-active={active}
                style={cell === undefined ? undefined : splitPaneStyle(cell)}
                onPointerDownCapture={() => {
                  workspace.focus(pane);
                }}
                onFocusCapture={() => {
                  workspace.focus(pane);
                }}
              >
                {/* 身份和父级位置始终稳定，增删相邻窗口不重建输入框或时间线。 */}
                <SplitPaneProvider
                  pane={pane}
                  active={active}
                  multiple={multiple}
                  toggleSidebar={toggleSidebar}
                  sidebarOpen={sidebarOpen}
                >
                  {children(pane)}
                </SplitPaneProvider>
              </section>
            </SplitPaneMenu>
          </Activity>
        );
      })}
      {multiple && layout !== undefined ? (
        <SplitWorkspaceResizers
          layout={layout}
          containerRef={containerRef}
          resize={workspace.resize}
          widthLabel={splitLabels.resizeWidth ?? `${label} ↔`}
          heightLabel={splitLabels.resizeHeight ?? `${label} ↕`}
        />
      ) : null}
    </div>
  );
}

export function useNavigateSplitTask() {
  const pane = useContext(SplitPaneContext);
  const workspace = useSplitWorkspaceState(pane === null);
  const activePane = useSplitActivePane(pane === null);
  const actions = useSplitWorkspaceActions();
  // 左栏异步创建任务也绑定发起时的窗口，避免等待期间的焦点变化覆盖其他聊天。
  const identity =
    (pane !== null &&
    (pane.multiple ||
      (pane.pane.draftId !== undefined && pane.pane.draftId !== ROUTE_SPLIT_DRAFT_ID))
      ? pane.pane
      : undefined) ?? (workspace?.enabled && workspace.panes.length > 1 ? activePane : undefined);
  const replace = actions?.replace;
  return useCallback(
    (projectId: string, taskId: string) => {
      if (identity === undefined || replace === undefined) return false;
      replace(identity, { projectId, taskId });
      return true;
    },
    [identity, replace],
  );
}

export function useOpenSplitDraft() {
  const pane = useContext(SplitPaneContext);
  const workspace = useSplitWorkspaceState(pane === null);
  const actions = useSplitWorkspaceActions();
  return useCallback(
    (projectId: string) => {
      if (
        actions === null ||
        (pane !== null &&
          !pane.multiple &&
          (pane.pane.draftId === undefined || pane.pane.draftId === ROUTE_SPLIT_DRAFT_ID)) ||
        (pane === null && (!workspace?.enabled || workspace.panes.length < 2))
      )
        return false;
      // 每次新建都分配独立草稿身份；同项目多窗不会串写，也不会接收旧草稿的迟到结果。
      // getRandomValues 在 HTTP 部署中也可用，随机身份避免多标签页写入相同持久化草稿。
      const draft = createSplitDraft(projectId);
      if (pane === null) return actions.select(draft);
      // 窗口内切换草稿范围只替换所属窗口，恢复单窗后仍可继续创建任务。
      actions.replace(pane.pane, draft);
      return true;
    },
    [pane, workspace, actions],
  );
}

function createSplitDraft(projectId: string): SplitPaneIdentity {
  const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
    value.toString(16).padStart(8, "0"),
  ).join("");
  return { projectId, draftId: `split-draft:${id}` };
}
