import type { Project, ProjectFileSearchPage } from "@codexly/protocol";

import type { CodexlyProjectFileSearchClient } from "../projects/project-query-contracts.js";

export type SearchFile = ProjectFileSearchPage["data"][number] & {
  projectId: string;
  projectName: string;
};

export async function searchFiles(
  client: CodexlyProjectFileSearchClient,
  projects: readonly Project[],
  query: string,
  signal: AbortSignal,
) {
  const roots = projects.flatMap((project) => project.roots.map((root) => ({ project, root })));
  const files: SearchFile[] = [];
  const failedRoots: string[] = [];
  let truncated = false;
  let offset = 0;
  // 全局限制为两个并发根目录，避免大型工作区同时占满磁盘与 Provider 请求队列。
  await Promise.all(
    Array.from({ length: Math.min(2, roots.length) }, async () => {
      while (offset < roots.length) {
        signal.throwIfAborted();
        const entry = roots[offset++];
        if (entry === undefined) break;
        const { project, root } = entry;
        try {
          const page = await client.searchProjectFiles(
            project.id,
            root.path,
            query,
            crypto.randomUUID(),
            { signal },
          );
          signal.throwIfAborted();
          for (const file of page.data) {
            if (files.length >= 50) {
              truncated = true;
              break;
            }
            files.push({ ...file, projectId: project.id, projectName: project.name });
          }
          truncated ||= page.data.length >= 50;
        } catch {
          signal.throwIfAborted();
          failedRoots.push(`${project.name}: ${root.path}`);
        }
      }
    }),
  );
  files.sort(
    (left, right) =>
      left.projectName.localeCompare(right.projectName) || left.path.localeCompare(right.path),
  );
  return { failedRoots, files, truncated };
}
