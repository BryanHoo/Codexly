import { useEffect, useRef } from "react";

type UseProjectGitStatusRefreshOptions = Readonly<{
  enabled: boolean;
  refresh: () => Promise<unknown>;
  scopeKey: string;
}>;

type WindowFocusTarget = Pick<Window, "addEventListener" | "removeEventListener">;

export function refreshProjectGitStatusForScopeChange(
  previousScopeKey: string,
  scopeKey: string,
  enabled: boolean,
  refresh: () => Promise<unknown>,
): string {
  if (enabled && previousScopeKey !== scopeKey) void refresh();
  return scopeKey;
}

export function subscribeProjectGitStatusWindowFocus(
  refresh: () => Promise<unknown>,
  target: WindowFocusTarget = window,
): () => void {
  const handleFocus = () => {
    void refresh();
  };
  target.addEventListener("focus", handleFocus);
  return () => {
    target.removeEventListener("focus", handleFocus);
  };
}

export function useProjectGitStatusRefresh({
  enabled,
  refresh,
  scopeKey,
}: UseProjectGitStatusRefreshOptions): void {
  const previousScopeKeyRef = useRef(scopeKey);

  useEffect(() => {
    // 同一工作台内切换 Task 不会重新挂载 Query，需要主动校准 Git 状态。
    previousScopeKeyRef.current = refreshProjectGitStatusForScopeChange(
      previousScopeKeyRef.current,
      scopeKey,
      enabled,
      refresh,
    );
  }, [enabled, refresh, scopeKey]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeProjectGitStatusWindowFocus(refresh);
  }, [enabled, refresh]);
}
