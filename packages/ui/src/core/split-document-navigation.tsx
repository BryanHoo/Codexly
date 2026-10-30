import { useCallback, useRef, type RefObject } from "react";
import { confirmTaskProjectChange } from "@codexly/frontend-core/split-task-navigation";
import type { SplitPaneIdentity } from "@codexly/frontend-core/split-workspace";

/** 任务入口保持同步接管语义，实际跨项目替换等待保存确认；较新的导航优先。 */
export function useGuardedTaskNavigation(
  selection: RefObject<{ panes: readonly SplitPaneIdentity[] }>,
) {
  const generation = useRef(0);
  return useCallback(
    (previous: SplitPaneIdentity | undefined, next: SplitPaneIdentity, apply: () => void) => {
      const request = ++generation.current;
      const panes = selection.current.panes;
      const allowed = previous ? confirmTaskProjectChange(previous, next) : true;
      if (typeof allowed === "boolean") {
        if (allowed) apply();
        return;
      }
      void allowed
        .then((confirmed) => {
          // 确认期间窗口集合或导航意图改变，旧保存回执不能再替换任务。
          if (confirmed && request === generation.current && selection.current.panes === panes)
            apply();
        })
        .catch(() => undefined);
    },
    [selection],
  );
}
