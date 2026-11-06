import { lazy, Suspense } from "react";
import type { RemoteRepositoryTarget } from "@codexly/ui/core/project-remote-repository-menu-item";
export type { RemoteRepositoryTarget };
export type RemoteRepositoryMenuProps = Readonly<{
  target: RemoteRepositoryTarget;
  variant: "context" | "dropdown";
}>;
// 只有展开菜单才加载完整平台适配与查询，避免增加工作台和编辑器首载依赖。
const Content = lazy(() => import("./project-remote-repository-menu-content.js"));
export function ProjectRemoteRepositoryMenuItem(props: RemoteRepositoryMenuProps) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
