import type { ProjectGitStatus } from "@/protocol/index.js";
import type { QueryClient } from "@tanstack/react-query";

import type { AgentFileChange } from "../diff/file-change.js";
import {
  type NativeGitStatusClient,
} from "../projects/project-queries.js";

const loadedDiffs = new WeakSet<AgentFileChange>();

export async function loadProjectGitFileDiff(
  queryClient: QueryClient,
  client: NativeGitStatusClient,
  projectId: string,
  rootPath: string,
  summary: ProjectGitStatus | undefined,
  change: AgentFileChange,
  repository: string | null = null,
): Promise<AgentFileChange> {
  if (summary === undefined || change.diff !== "" || loadedDiffs.has(change)) return change;

  const location = summary.unstaged.some((entry) => entry === change || (entry.path === change.path && !summary.staged.includes(change))) ? "unstaged" : "staged";
  const details = await queryClient.fetchQuery(
    {
      // 每个快照按文件隔离缓存，避免打开一个文件时读取整仓补丁。
      queryKey: ["projects", projectId, rootPath, "git-file-diff", repository, summary.snapshot, location, change.path],
      queryFn: ({ signal }) => client.getProjectGitStatus(projectId, {
        rootPath, diffPath: change.path, diffStaged: location === "staged",
        ...(repository === null ? {} : { repository }),
      }, { signal }),
      staleTime: 30_000,
      gcTime: 30_000,
      retry: false,
    },
  );
  const loaded = (
    details[location].find(
      (candidate) => candidate.path === change.path,
    ) ?? { ...change }
  );
  loadedDiffs.add(loaded);
  // 缓存正文最多保留 16 个文件（约 8 MiB），不能只靠时间淘汰积累大量补丁。
  const cached = queryClient.getQueryCache().findAll({ predicate: (query) => query.queryKey[3] === "git-file-diff" && query.state.data !== undefined && !query.isActive() })
    .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt);
  for (const query of cached.slice(16)) queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
  return loaded;
}
