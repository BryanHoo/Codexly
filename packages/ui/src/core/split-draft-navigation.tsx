import type { MouseEvent } from "react";
import { useOpenSplitDraft } from "./split-workspace.js";

// 两端侧栏共用创建与链接点击规则，平台只提供普通路由和移动侧栏收起逻辑。
export function useSidebarDraftNavigation(
  temporaryProjectId: string,
  navigate: (projectId: string) => Promise<unknown>,
) {
  const openSplitDraft = useOpenSplitDraft();
  const openDraft = async (projectId: string) => {
    if (!openSplitDraft(projectId)) await navigate(projectId);
  };
  const onNewTaskClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    if (openSplitDraft(temporaryProjectId)) event.preventDefault();
  };
  return { openDraft, onNewTaskClick };
}
