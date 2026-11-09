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

/** 同一底栏的功能入口共享来源；使用 ref 避免记录地址时触发额外渲染。 */
export function SidebarPageToggleProvider({ children }: Readonly<{ children: ReactNode }>) {
  const source = useRef<SidebarSource | undefined>(undefined);
  return <SidebarPageSourceContext value={source}>{children}</SidebarPageSourceContext>;
}

/** 两端共用底栏页面切换；只保存来源地址，不复制工作区或会话状态。 */
export function useSidebarPageToggle({
  projectId,
  page,
  location,
  navigate,
}: Readonly<{
  projectId: string | undefined;
  page: "scheduled" | "extensions";
  location: Readonly<{ href: string; pathname: string }>;
  navigate: (href: string) => Promise<unknown>;
}>) {
  const base =
    projectId && projectId !== TEMPORARY_TASK_SCOPE_ID
      ? `/p/${encodeURIComponent(projectId)}`
      : "/temporary";
  const target = `${base}/${page}`;
  const active = location.pathname === target || location.pathname.startsWith(`${target}/`);
  const source = useContext(SidebarPageSourceContext);
  if (!source) throw new Error("Sidebar page links require SidebarPageToggleProvider");
  const inFeaturePage = ["scheduled", "extensions"].some((feature) => {
    const path = `${base}/${feature}`;
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  });
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
      // 两个功能页之间切换时保留最初任务页，不能把另一个功能页记为返回目标。
      if (!inFeaturePage) source.current = { base, href: location.href };
      return;
    }
    event.preventDefault();
    // 直接打开功能页或切换项目后没有可用来源时，返回当前范围的工作台。
    void navigate(source.current?.base === base ? source.current.href : base);
  };
  // 扩展中心所有分类共用选中态，不局限于入口默认打开的 skills 分类。
  const stateProps = {
    "data-status": active ? "active" : undefined,
    "aria-current": active ? ("page" as const) : undefined,
  };
  return { onClick, activeProps: stateProps, inactiveProps: stateProps };
}
