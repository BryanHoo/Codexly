import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Project } from "@codexly/protocol";

import type { CodexlyWorkbenchClient } from "../projects/project-query-contracts.js";
import { searchFiles } from "./search-files.js";

export type SearchCategory = "all" | "tasks" | "history" | "files";

export function useGlobalSearch(
  client: CodexlyWorkbenchClient,
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
    const timer = window.setTimeout(() => {
      setSettled(query);
    }, 180);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query]);
  const enabled = active && query.length > 0 && query === settled && !composing;
  const common = {
    gcTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  } as const;
  const tasks = useQuery({
    ...common,
    enabled: enabled && (category === "all" || category === "tasks"),
    queryFn: ({ signal }) =>
      client.searchTasks(
        {
          archived,
          ...(taskCursor === undefined ? {} : { cursor: taskCursor }),
          kind: "tasks",
          query,
        },
        { signal },
      ),
    queryKey: ["global-search", "tasks", query, archived, taskCursor],
  });
  const history = useQuery({
    ...common,
    enabled: enabled && (category === "all" || category === "history"),
    queryFn: ({ signal }) =>
      client.searchTasks(
        {
          archived,
          ...(historyCursor === undefined ? {} : { cursor: historyCursor }),
          kind: "history",
          query,
        },
        { signal },
      ),
    queryKey: ["global-search", "history", query, archived, historyCursor],
  });
  const files = useQuery({
    ...common,
    enabled: enabled && (category === "all" || category === "files"),
    queryFn: ({ signal }) => searchFiles(client, projects, query, signal),
    queryKey: ["global-search", "files", query, projects.map(({ id, roots }) => [id, roots])],
  });
  return { files, history, tasks, waiting: query.length > 0 && !enabled };
}
