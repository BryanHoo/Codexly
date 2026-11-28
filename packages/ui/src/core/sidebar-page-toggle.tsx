import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import {
  createContext,
  useContext,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

type SidebarSource = Readonly<{ base: string; href: string }>;
const SidebarPageSourceContext = createContext<RefObject<SidebarSource | undefined> | null>(null);

/** 定时任务入口需要在路由切换后保留来源，使用 ref 记录地址以避免额外渲染。 */
export function SidebarPageToggleProvider({ children }: Readonly<{ children: ReactNode }>) {
  const source = useRef<SidebarSource | undefined>(undefined);
  return <SidebarPageSourceContext value={source}>{children}</SidebarPageSourceContext>;
}

/** 两端的定时任务入口共用返回逻辑，记录完整来源地址以保留查询参数和锚点。 */
export function useSidebarPageToggle({
  projectId,
  location,
  navigate,
}: Readonly<{
  projectId: string | undefined;
  location: Readonly<{ href: string; pathname: string }>;
  navigate: (href: string) => Promise<unknown>;
}>) {
  const base =
    projectId && projectId !== TEMPORARY_TASK_SCOPE_ID
      ? `/p/${encodeURIComponent(projectId)}`
      : "/temporary";
  const target = `${base}/scheduled`;
  const active = location.pathname === target;
  const source = useContext(SidebarPageSourceContext);
  if (!source) throw new Error("Sidebar page links require SidebarPageToggleProvider");
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // 修饰键与非主键点击仍交给链接，保留浏览器的新标签和新窗口行为。
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    if (!active) {
      source.current = { base, href: location.href };
      return;
    }
    event.preventDefault();
    // 直接打开功能页或切换项目后没有可用来源时，返回当前范围的工作台。
    void navigate(source.current?.base === base ? source.current.href : base);
  };
  const stateProps = {
    "data-status": active ? "active" : undefined,
    "aria-current": active ? ("page" as const) : undefined,
  };
  return { onClick, activeProps: stateProps, inactiveProps: stateProps };
}
