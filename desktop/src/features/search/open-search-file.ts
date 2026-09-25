import type { QueryClient } from "@tanstack/react-query";
import type { NativeWorkbenchClient } from "../projects/project-query-contracts.js";
import type { SearchFile } from "./search-files.js";
import { classifyProjectFileReference } from "../workbench/project-file-reference.js";

export async function prepareSearchFile(
  client: Pick<
    NativeWorkbenchClient,
    "readProjectSourceFile" | "cacheProjectImage" | "openProject"
  >,
  cache: QueryClient,
  file: SearchFile,
  signal?: AbortSignal,
): Promise<"source" | "image" | null> {
  signal?.throwIfAborted();
  const kind = classifyProjectFileReference(file.path);
  if (kind !== "system") {
    try {
      // 预检只读取首个受限页面并复用预览缓存，二进制拒绝后直接交给系统应用。
      if (kind === "source") {
        await cache.fetchInfiniteQuery({
          queryKey: [
            "projects",
            file.projectId,
            null,
            file.rootPath,
            "source-file",
            file.path,
          ],
          initialPageParam: undefined as number | undefined,
          queryFn: ({ signal, pageParam }) =>
            client.readProjectSourceFile(
              file.projectId,
              file.rootPath,
              file.path,
              pageParam,
              { signal },
            ),
          retry: false,
          staleTime: 30_000,
          gcTime: 30_000,
        });
      } else {
        await cache.fetchQuery({
          queryKey: [
            "projects",
            file.projectId,
            null,
            file.rootPath,
            "image-file",
            file.path,
          ],
          queryFn: ({ signal }) =>
            client.cacheProjectImage(file.projectId, file.rootPath, file.path, {
              signal,
            }),
          retry: false,
          staleTime: 30_000,
          gcTime: 30_000,
        });
      }
      signal?.throwIfAborted();
      return kind;
    } catch {
      // 文件类型、编码或预览资源不可读时仍允许系统默认应用尝试打开。
    }
  }
  signal?.throwIfAborted();
  await client.openProject(file.projectId, file.rootPath, {
    appId: "system-default",
    path: file.path,
  });
  return null;
}
