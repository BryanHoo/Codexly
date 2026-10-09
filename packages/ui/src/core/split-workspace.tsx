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
  splitLayout,
  type SplitDirection,
  type SplitLayout,
} from "@codexly/frontend-core/split-layout";
import { SplitPaneMenu, SplitWorkspaceShortcuts } from "./split-workspace-actions.js";

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
  layout: SplitLayout | undefined;
  split: (pane: SplitPaneIdentity, direction: SplitDirection) => void;
  add: (pane: SplitPaneIdentity) => void;
  close: (pane: SplitPaneIdentity) => void;
  focus: (pane: SplitPaneIdentity) => void;
  select: (pane: SplitPaneIdentity) => boolean;
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
      const alreadyOpen = selection.panes.some((item) => splitPaneKey(item) === splitPaneKey(pane));
      // 单窗口和移动端继续走普通路由；真正分屏时由工作区接管左栏任务切换。
      if (!alreadyOpen && (!enabled || selection.panes.length < 2)) return false;
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
    [enabled, selection.panes],
  );
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
  const value = useMemo(
    () => ({
      enabled,
      panes: selection.panes,
      activeKey: selection.activeKey,
      layout: selection.layout,
      split,
      add,
      close,
      focus,
      select,
      solo,
      replace,
    }),
    [
      enabled,
      selection.panes,
      selection.activeKey,
      selection.layout,
      split,
      add,
      close,
      focus,
      select,
      solo,
      replace,
    ],
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
  splitLabels,
}: Readonly<{
  children: (pane: SplitPaneIdentity) => ReactNode;
  label: string;
  toggleSidebar: () => void;
  sidebarOpen: boolean;
  splitLabels: Readonly<Record<SplitDirection, string> & { limit: string }>;
}>) {
  const workspace = useSplitWorkspace();
  if (workspace === null) throw new Error("Missing split workspace provider");
  const multiple = workspace.enabled && workspace.panes.length > 1;
  const cells = useMemo(
    () => (workspace.layout === undefined ? undefined : getSplitLayoutCells(workspace.layout)),
    [workspace.layout],
  );
  return (
    <div
      className="split-workspace"
      data-multiple={multiple}
      data-count={multiple ? workspace.panes.length : 1}
      data-directed={multiple && cells !== undefined}
      aria-label={label}
    >
      <SplitWorkspaceShortcuts workspace={workspace} />
      {workspace.panes.map((pane) => {
        const key = splitPaneKey(pane);
        const active = key === workspace.activeKey;
        const cell = multiple ? cells?.get(key) : undefined;
        return (
          <Activity key={key} mode={workspace.enabled || active ? "visible" : "hidden"}>
            <SplitPaneMenu pane={pane} labels={splitLabels} workspace={workspace}>
              <section
                className="split-workspace-pane"
                data-split-pane={key}
                data-active={active}
                style={
                  cell === undefined
                    ? undefined
                    : {
                        gridColumn: `${String(cell.x + 1)} / span ${String(cell.width)}`,
                        gridRow: `${String(cell.y + 1)} / span ${String(cell.height)}`,
                      }
                }
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
            </SplitPaneMenu>
          </Activity>
        );
      })}
    </div>
  );
}

export function useNavigateSplitTask() {
  const pane = useContext(SplitPaneContext);
  const workspace = useSplitWorkspace();
  // 左栏异步创建任务也绑定发起时的窗口，避免等待期间的焦点变化覆盖其他聊天。
  const identity =
    (pane?.pane.draftId === ROUTE_SPLIT_DRAFT_ID && !pane.multiple ? undefined : pane?.pane) ??
    (workspace?.enabled && workspace.panes.length > 1
      ? workspace.panes.find((item) => splitPaneKey(item) === workspace.activeKey)
      : undefined);
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

export function useOpenSplitDraft() {
  const pane = useContext(SplitPaneContext);
  const workspace = useSplitWorkspace();
  return useCallback(
    (projectId: string) => {
      if (
        workspace === null ||
        (pane?.pane.draftId === ROUTE_SPLIT_DRAFT_ID && !pane.multiple) ||
        (pane === null && (!workspace.enabled || workspace.panes.length < 2))
      )
        return false;
      // 每次新建都分配独立草稿身份；同项目多窗不会串写，也不会接收旧草稿的迟到结果。
      // getRandomValues 在 HTTP 部署中也可用，随机身份避免多标签页写入相同持久化草稿。
      const draft = createSplitDraft(projectId);
      if (pane === null) return workspace.select(draft);
      // 窗口内切换草稿范围只替换所属窗口，恢复单窗后仍可继续创建任务。
      workspace.replace(pane.pane, draft);
      return true;
    },
    [pane, workspace],
  );
}

function createSplitDraft(projectId: string): SplitPaneIdentity {
  const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
    value.toString(16).padStart(8, "0"),
  ).join("");
  return { projectId, draftId: `split-draft:${id}` };
}
