import type { Query, QueryClient } from "@tanstack/react-query";

type FocusTarget = Readonly<{
  addEventListener: (type: "focus", listener: () => void) => void;
  removeEventListener: (type: "focus", listener: () => void) => void;
}>;

function isProjectGitStatusQuery(query: Query): boolean {
  const { queryKey } = query;
  return (
    queryKey.length === 4 && queryKey[0] === "projects" && queryKey[3] === "git-status"
  );
}

export function installProjectGitStatusFocusRefresh(
  queryClient: QueryClient,
  target: FocusTarget | undefined = globalThis.window,
): () => void {
  if (target === undefined) return () => undefined;

  const refreshActiveGitStatus = () => {
    // 外部 Git 操作通常发生在其他窗口，重新聚焦时只校准当前可见项目。
    void queryClient.refetchQueries({
      predicate: isProjectGitStatusQuery,
      type: "active",
    });
  };
  target.addEventListener("focus", refreshActiveGitStatus);
  return () => target.removeEventListener("focus", refreshActiveGitStatus);
}
