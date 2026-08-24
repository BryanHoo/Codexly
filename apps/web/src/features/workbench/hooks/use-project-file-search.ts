import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { v4 as createUuid } from "uuid";

import type { CodexlyProjectFileSearchClient } from "../../projects/project-queries.js";

export const PROJECT_FILE_SEARCH_DEBOUNCE_MS = 150;

export function projectFileSearchQueryOptions(
  client: CodexlyProjectFileSearchClient,
  projectId: string,
  rootPath: string,
  sessionId: string,
  query: string,
  enabled: boolean,
) {
  return queryOptions({
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      client.searchProjectFiles(projectId, rootPath, query, sessionId, { signal }),
    queryKey: ["projects", projectId, rootPath, "file-search", sessionId, query] as const,
    staleTime: 30_000,
  });
}

export function stopProjectFileSearchSession(
  client: CodexlyProjectFileSearchClient,
  projectId: string,
  rootPath: string,
  sessionId: string,
): void {
  // 页面卸载或菜单关闭时连接可能已断开，清理失败不应覆盖用户当前操作。
  void client.stopProjectFileSearch(projectId, rootPath, sessionId).catch(() => undefined);
}

export function useProjectFileSearch(
  client: CodexlyProjectFileSearchClient,
  projectId: string,
  rootPath: string,
  query: string,
  enabled: boolean,
) {
  const searchSession = useMemo(
    () => ({ enabled, id: createUuid(), projectId, rootPath }),
    [enabled, projectId, rootPath],
  );
  const sessionId = searchSession.id;
  const [debouncedState, setDebouncedState] = useState({ enabled: false, query });
  useEffect(() => {
    if (!enabled) {
      setDebouncedState((current) =>
        !current.enabled && current.query === query ? current : { enabled: false, query },
      );
      return undefined;
    }
    // 只提交用户停顿后的最终查询，避免候选列表在连续输入时反复切换加载状态。
    const timeout = setTimeout(() => {
      setDebouncedState({ enabled: true, query });
    }, PROJECT_FILE_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [enabled, query]);
  useEffect(() => {
    if (!enabled) return undefined;
    return () => {
      stopProjectFileSearchSession(client, projectId, rootPath, sessionId);
    };
  }, [client, enabled, projectId, rootPath, sessionId]);

  const debounceSettled = debouncedState.enabled && debouncedState.query === query;
  return useQuery(
    projectFileSearchQueryOptions(
      client,
      projectId,
      rootPath,
      sessionId,
      debouncedState.query,
      enabled && debounceSettled,
    ),
  );
}
