import type { Project, ProjectFileSearchPage } from "@/protocol/index.js";
import type { NativeProjectFileSearchClient } from "../projects/project-query-contracts.js";

export type SearchFile = ProjectFileSearchPage["data"][number] & {
  projectId: string;
  projectName: string;
};

export async function searchFiles(
  client: NativeProjectFileSearchClient,
  projects: readonly Project[],
  query: string,
  signal: AbortSignal,
) {
  const roots = projects.flatMap((project) =>
    project.roots.map((root) => ({ project, root })),
  );
  const files: SearchFile[] = [];
  const failedRoots: string[] = [];
  let truncated = false;
  let offset = 0;
  // 全局最多两个目录请求并行，配合 Rust 的扫描信号量限制磁盘和 IPC 压力。
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
            files.push({
              ...file,
              projectId: project.id,
              projectName: project.name,
            });
          }
          truncated ||= page.data.length >= 50;
        } catch {
          signal.throwIfAborted();
          failedRoots.push(`${project.name}: ${root.path}`);
          // 单个根目录失败不丢弃其他数据源的结果。
        }
      }
    }),
  );
  files.sort(
    (a, b) =>
      a.projectName.localeCompare(b.projectName) ||
      a.path.localeCompare(b.path),
  );
  return { files, failedRoots, truncated };
}
