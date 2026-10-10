import { buildProjectImageFileUrl } from "@codexly/client";
import { MessageImageProvider } from "@codexly/ui/core/message-markdown-image";
import { useCallback, useContext, type ReactNode } from "react";
import {
  ProjectDataContext,
  ProjectRootSelectionContext,
} from "../../projects/project-context-state.js";
import { resolveProjectRootFromSelections } from "../../projects/project-root-selection.js";

const emptyRootSelections = new Map<string, string>();

export function TimelineImageProvider({
  children,
  projectId,
  rootPath,
}: {
  children: ReactNode;
  projectId: string;
  rootPath: string | undefined;
}) {
  const projects = useContext(ProjectDataContext)?.projects;
  const rootSelections = useContext(ProjectRootSelectionContext)?.selectedRootIds;
  // 普通任务不携带 workspacePath，沿用所属项目的根选择；worktree 明确绑定的目录始终优先。
  const project =
    rootPath === undefined ? projects?.find((item) => item.id === projectId) : undefined;
  const imageRootPath =
    rootPath ??
    resolveProjectRootFromSelections(project, rootSelections ?? emptyRootSelections)?.path;
  // 以任务实际工作目录解析相对图片，分屏、worktree 和历史回放均不依赖活动项目目录。
  const resolveImage = useCallback(
    (path: string) => buildProjectImageFileUrl("", projectId, path, imageRootPath),
    [projectId, imageRootPath],
  );
  return <MessageImageProvider resolveImage={resolveImage}>{children}</MessageImageProvider>;
}
