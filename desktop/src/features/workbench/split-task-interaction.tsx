import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

export const SplitTaskInteractionContext = createContext<ReadonlySet<string>>(new Set());
const ReportTaskInteractionContext = createContext<
  ((key: string, blocked: boolean) => void) | null
>(null);

export function SplitTaskInteractionProvider({ children }: { children: ReactNode }) {
  const [blockedTasks, setBlockedTasks] = useState<ReadonlySet<string>>(() => new Set());
  const report = useCallback((key: string, blocked: boolean) => {
    setBlockedTasks((previous) => {
      if (previous.has(key) === blocked) return previous;
      const next = new Set(previous);
      if (blocked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  return (
    <ReportTaskInteractionContext value={report}>
      <SplitTaskInteractionContext value={blockedTasks}>{children}</SplitTaskInteractionContext>
    </ReportTaskInteractionContext>
  );
}

export function useReportSplitTaskInteraction(projectId: string, taskId: string | undefined, blocked: boolean) {
  const report = useContext(ReportTaskInteractionContext);
  const key = JSON.stringify([projectId, taskId]);
  useLayoutEffect(() => {
    if (taskId === undefined) return;
    // 侧栏在窗口外渲染，单独同步低频写权限；不广播消息正文或整个任务 Store。
    report?.(key, blocked);
    return () => {
      report?.(key, false);
    };
  }, [blocked, key, report, taskId]);
}
