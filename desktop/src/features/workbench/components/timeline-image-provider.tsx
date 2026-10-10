import { QueryClientContext } from "@tanstack/react-query";
import { MessageImageProvider } from "@codexly/ui/core/message-markdown-image";
import { useCallback, useContext, type ReactNode } from "react";
import { ProjectDataContext } from "../../projects/project-context-state.js";

export function TimelineImageProvider({ children, projectId, taskId, rootPath }: {
  children: ReactNode;
  projectId: string;
  taskId: string;
  rootPath: string | undefined;
}) {
  const client = useContext(ProjectDataContext)?.client;
  const queryClient = useContext(QueryClientContext);
  const resolveImage = useCallback((path: string) => () => {
    if (client === undefined || queryClient === undefined) return Promise.reject(new Error("Image client unavailable"));
    // 与文件面板共用查询缓存，合并重复图片读取；IPC 仅返回缓存路径，不传输 Base64 图片。
    return queryClient.fetchQuery({
      queryKey: ["projects", projectId, taskId, rootPath ?? null, "image-file", path],
      queryFn: () => client.cacheProjectImage(projectId, rootPath, path, { taskId }),
      staleTime: 30_000,
      gcTime: 30_000,
      retry: false,
    });
  }, [client, queryClient, projectId, taskId, rootPath]);
  return <MessageImageProvider resolveImage={resolveImage}>{children}</MessageImageProvider>;
}
