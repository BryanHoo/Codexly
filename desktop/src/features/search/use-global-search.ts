import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Project } from "@/protocol/index.js";
import type { NativeWorkbenchClient } from "../projects/project-query-contracts.js";
import { searchFiles } from "./search-files.js";

export type SearchCategory = "all" | "tasks" | "history" | "files";
export function useGlobalSearch(
  client: NativeWorkbenchClient,
  projects: readonly Project[],
  query: string,
  category: SearchCategory,
  archived: boolean,
  composing: boolean,
  taskCursor?: string,
  historyCursor?: string,
  active = true,
) {
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query), 180);
    return () => clearTimeout(timer);
  }, [query]);
  const enabled = active && query.length > 0 && query === settled && !composing;
  const common = {
    gcTime: 30_000,
    // 当前会话结果由已挂载的 observer 保留，重新开窗不触发过期重搜。
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  } as const;
  const tasks = useQuery({
    ...common,
    enabled: enabled && (category === "all" || category === "tasks"),
    queryKey: ["global-search", "tasks", query, archived, taskCursor],
    queryFn: ({ signal }) =>
      client.searchTasks(
        {
          query,
          archived,
          kind: "tasks",
          ...(taskCursor === undefined ? {} : { cursor: taskCursor }),
        },
        { signal },
      ),
  });
  const history = useQuery({
    ...common,
    enabled: enabled && (category === "all" || category === "history"),
    queryKey: ["global-search", "history", query, archived, historyCursor],
    queryFn: ({ signal }) =>
      client.searchTasks(
        {
          query,
          archived,
          kind: "history",
          ...(historyCursor === undefined ? {} : { cursor: historyCursor }),
        },
        { signal },
      ),
  });
  // Client 是 Provider 内稳定的传输实例，不参与可序列化缓存键。
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const files = useQuery({
    ...common,
    enabled: enabled && (category === "all" || category === "files"),
    queryKey: [
      "global-search",
      "files",
      query,
      projects.map(({ id, roots }) => [id, roots]),
    ],
    queryFn: ({ signal }) => searchFiles(client, projects, query, signal),
  });
  return { tasks, history, files, waiting: query.length > 0 && !enabled };
}
