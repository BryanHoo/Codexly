import { useEffect, useState, type RefObject } from "react";

export function useTimelineNavigationHost(scrollContainerRef: RefObject<HTMLDivElement | null>) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  // 子组件 layout effect 早于滚动父节点的 ref 挂载；提交结束后再读取归属。
  useEffect(() => {
    const container = scrollContainerRef.current;
    // 从本时间线向上寻找归属，不用全局选择器，避免多个聊天目录叠到同一位置。
    setHost(
      container?.closest<HTMLElement>(".split-workspace-pane") ??
        container?.closest<HTMLElement>(".workbench-shell") ??
        null,
    );
  }, [scrollContainerRef]);
  return host;
}
