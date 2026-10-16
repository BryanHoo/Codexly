import type { AgentTurn } from "@codexly/protocol";
import { getEmbeddedSubagentTurn } from "@codexly/frontend-core/tool-presentation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "./button.js";

// 两端 Item Store 的结构兼容，避免为 Claude 子代理新增独立会话、请求或轮询。
export function EmbeddedSubagentOutput({
  store,
  renderItem,
  loadOlderLabel,
}: Readonly<{
  store: {
    subscribe: (listener: () => void) => () => void;
    getState: () => { revision: number };
    read: () => unknown;
  };
  renderItem: (item: AgentTurn["items"][number], turn: AgentTurn, index: number) => ReactNode;
  loadOlderLabel: string;
}>) {
  const [visibleCount, setVisibleCount] = useState(50);
  useSyncExternalStore(
    store.subscribe,
    () => store.getState().revision,
    () => store.getState().revision,
  );
  const turn = getEmbeddedSubagentTurn(store.read());
  if (!turn) return null;
  const start = Math.max(0, turn.items.length - visibleCount);
  return (
    <div className="h-full space-y-3 overflow-y-auto p-4" data-embedded-subagent-output="">
      {start > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setVisibleCount((count) => count + 50);
          }}
        >
          {loadOlderLabel}
        </Button>
      ) : null}
      {turn.items.slice(start).map((item, index) => (
        <div key={item.id}>{renderItem(item, turn, start + index)}</div>
      ))}
    </div>
  );
}
