import type { AgentTask, CompletedTasksPage, CompletedTasksQuery } from "@codexly/protocol";
import type { AgentProvider } from "./agent-provider.js";

export class CompletedTasksQueryError extends Error {}
type ResolveProvider = (scopeId: string) => Promise<Pick<AgentProvider, "listTasks">>;

/** 跨项目查询由服务端统一分配页容量，前端只传回上次响应的游标。 */
export async function queryCompletedTasks(
  resolve: ResolveProvider,
  input: CompletedTasksQuery,
): Promise<CompletedTasksPage> {
  const { projectIds, cursor } = input;
  const scopes = new Set(projectIds);
  if (scopes.size !== projectIds.length || scopes.size > 100)
    throw new CompletedTasksQueryError("Invalid completed task scopes");
  if (
    cursor !== undefined &&
    (Object.keys(cursor).length !== scopes.size ||
      Object.keys(cursor).some((id) => !scopes.has(id)))
  ) {
    throw new CompletedTasksQueryError("Completed task cursor does not match its scopes");
  }
  const active = projectIds.filter((id) => cursor === undefined || cursor[id] !== null);
  const limit = Math.max(1, Math.ceil(10 / Math.max(1, active.length)));
  const cursors: Record<string, string | null> = Object.fromEntries(
    projectIds.map((id) => [id, null]),
  );
  const tasks = new Map<string, AgentTask>();
  // 最多四个作用域同时读取，防止项目数量直接放大 Provider 并发。
  for (let index = 0; index < active.length; index += 4) {
    const pages = await Promise.all(
      active.slice(index, index + 4).map(async (id) => {
        const provider = await resolve(id);
        const previous = cursor?.[id];
        const page = await provider.listTasks({
          completed: true,
          limit,
          ...(typeof previous === "string" ? { cursor: previous } : {}),
        });
        if (page.data.length > limit) throw new Error("Completed task page exceeds its limit");
        if (page.nextCursor !== null && page.nextCursor === previous)
          throw new Error("Completed task page returned a repeated cursor");
        for (const task of page.data)
          if (task.projectId !== id) throw new Error("Completed task page crossed its scope");
        return { id, page };
      }),
    );
    for (const { id, page } of pages) {
      cursors[id] = page.nextCursor;
      for (const task of page.data) {
        const key = JSON.stringify([id, task.id]);
        if (!tasks.has(key)) tasks.set(key, task);
      }
    }
  }
  return {
    data: [...tasks.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    nextCursor: Object.values(cursors).some((value) => value !== null) ? cursors : null,
  };
}
