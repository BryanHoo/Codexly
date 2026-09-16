import type { QueryClient } from "@tanstack/react-query";

import type { CodexlyWorkbenchClient } from "../projects/project-query-contracts.js";
import { classifyProjectFileReference } from "../workbench/project-file-reference.js";
import type { SearchFile } from "./search-files.js";

export async function prepareSearchFile(
  client: Pick<CodexlyWorkbenchClient, "readProjectSourceFile" | "openProject">,
  cache: QueryClient,
  file: SearchFile,
  signal?: AbortSignal,
): Promise<"source" | "image" | null> {
  signal?.throwIfAborted();
  const kind = classifyProjectFileReference(file.path);
  if (kind === "image") return kind;
  if (kind === "source") {
    try {
      // 先验证首个受限文本页，二进制或不可读文件交给系统默认应用处理。
      await cache.fetchInfiniteQuery({
        gcTime: 30_000,
        initialPageParam: undefined as number | undefined,
        queryFn: ({ pageParam, signal }) =>
          client.readProjectSourceFile(file.projectId, file.rootPath, file.path, pageParam, {
            signal,
          }),
        queryKey: ["projects", file.projectId, file.rootPath, "source-file", file.path],
        retry: false,
        staleTime: 30_000,
      });
      signal?.throwIfAborted();
      return kind;
    } catch {
      signal?.throwIfAborted();
    }
  }
  await client.openProject(
    file.projectId,
    file.rootPath,
    { appId: "system-default", path: file.path },
    signal === undefined ? {} : { signal },
  );
  return null;
}
