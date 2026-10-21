import type { CodexlyClient } from "@codexly/client";
import type { WorkbenchChange } from "@codexly/protocol";
import type { Query, QueryClient } from "@tanstack/react-query";

export function installWorkbenchQuerySync(
  queryClient: QueryClient,
  client: Pick<CodexlyClient, "subscribeWorkbenchChanges">,
  target: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">,
) {
  const followUps = new Set<string>();
  let disposed = false;
  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "removed") {
      followUps.delete(event.query.queryHash);
      return;
    }
    if (
      event.type !== "updated" ||
      event.query.state.fetchStatus !== "idle" ||
      !followUps.delete(event.query.queryHash)
    )
      return;
    // 在途读取可能早于变更；等其结束后合并补读一次，既不取消共享请求，也不漏掉通知。
    queueMicrotask(() => {
      if (disposed) return;
      void queryClient.invalidateQueries(
        {
          queryKey: event.query.queryKey as readonly unknown[],
          exact: true,
          refetchType: target.visibilityState === "visible" ? "active" : "none",
        },
        { cancelRefetch: false },
      );
    });
  });
  const refresh = (change: WorkbenchChange) => {
    if (change.type === "task-activity.changed") return;
    const predicate = ({ queryKey: key }: Query) => {
      const questions = key[0] === "async-questions";
      const todos = key[0] === "projects" && key[2] === "todos";
      if (change.type === "workbench.ready") return questions || todos;
      if (change.type === "project-todos.changed") return todos && key[1] === change.projectId;
      return questions && key[1] === change.projectId && key[2] === change.taskId;
    };
    if (change.type !== "workbench.ready" && target.visibilityState === "visible") {
      for (const query of queryClient.getQueryCache().findAll({ predicate })) {
        if (query.state.fetchStatus === "fetching") followUps.add(query.queryHash);
      }
    }
    // 后台只标记缓存失效，不发送读取请求；可见后统一补读，保留跨设备最终一致性。
    void queryClient.invalidateQueries(
      {
        predicate,
        refetchType: target.visibilityState === "visible" ? "active" : "none",
      },
      { cancelRefetch: false },
    );
  };
  const unsubscribe = client.subscribeWorkbenchChanges(refresh);
  const onVisibilityChange = () => {
    if (target.visibilityState === "visible") refresh({ type: "workbench.ready" });
  };
  // Provider 级只安装一个监听和连接，分屏及多个待办观察器共用 Query 的在途请求。
  target.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    disposed = true;
    followUps.clear();
    unsubscribeCache();
    target.removeEventListener("visibilitychange", onVisibilityChange);
    unsubscribe();
  };
}
