type SearchProject = Readonly<{
  id: string;
  name: string;
  roots: readonly Readonly<{ path: string }>[];
}>;

export type SearchFile<File> = File & Readonly<{ projectId: string; projectName: string }>;

export async function searchFiles<File extends { path: string }>(
  projects: readonly SearchProject[],
  query: string,
  signal: AbortSignal,
  read: (
    projectId: string,
    rootPath: string,
    query: string,
    sessionId: string,
    options: { signal: AbortSignal },
  ) => Promise<{ data: readonly File[] }>,
) {
  const roots = projects.flatMap((project) => project.roots.map((root) => ({ project, root })));
  const files: SearchFile<File>[] = [];
  const failedRoots: string[] = [];
  let truncated = false;
  let offset = 0;
  // 并发上限和结果上限共享，避免任一端额外占用磁盘与传输队列。
  await Promise.all(
    Array.from({ length: Math.min(2, roots.length) }, async () => {
      while (offset < roots.length && files.length < 50) {
        signal.throwIfAborted();
        const entry = roots[offset++];
        if (entry === undefined) break;
        const { project, root } = entry;
        try {
          const page = await read(project.id, root.path, query, crypto.randomUUID(), { signal });
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
  truncated ||= files.length >= 50 && offset < roots.length;
  files.sort(
    (left, right) =>
      left.projectName.localeCompare(right.projectName) || left.path.localeCompare(right.path),
  );
  return { failedRoots, files, truncated };
}
