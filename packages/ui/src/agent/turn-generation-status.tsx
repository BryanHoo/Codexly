import { useMemo, useSyncExternalStore } from "react";
import type { AgentEngine } from "@codexly/protocol";
import type { TaskViewStoreState } from "@codexly/frontend-core/task-view-selectors";
import type { TurnOutputRates } from "@codexly/frontend-core/turn-output-rate";
import {
  formatTurnProcessingDuration,
  type TurnProcessingTiming,
} from "@codexly/frontend-core/turn-processing-time";

import { AgentEngineIcon } from "../core/agent-engine-icon.js";
import { TurnOutputRateLabel, useTurnProcessingTime } from "./use-turn-processing-time.js";

type GenerationStore = Readonly<{
  subscribe: (listener: () => void) => () => void;
  getState: () => Pick<
    TaskViewStoreState<{ type: string }>,
    "turnsById" | "itemKeysByTurnId" | "itemStoresByKey"
  > & {
    turnOutputRates: { current?: TurnOutputRates };
  };
}>;

const idleTiming: TurnProcessingTiming = {
  status: "completed",
  startedAt: null,
  completedAt: null,
};

export function TurnGenerationStatus({
  store,
  turnId,
  engine,
  generatingLabel,
  toolCallsLabel,
}: Readonly<{
  store: GenerationStore;
  turnId: string;
  engine: AgentEngine | undefined;
  generatingLabel: string;
  toolCallsLabel: (count: number) => string;
}>) {
  // 只订阅当前回合和条目索引，流式文本增量不触发状态行重绘。
  const readTurn = () => store.getState().turnsById[turnId];
  const turn = useSyncExternalStore(store.subscribe, readTurn, readTurn);
  const readItemKeys = () => store.getState().itemKeysByTurnId[turnId];
  const itemKeys = useSyncExternalStore(store.subscribe, readItemKeys, readItemKeys);
  // 首批输出到达时立即从占位切换到读数，后续增长随共用时钟刷新。
  const readOutputRate = () => store.getState().turnOutputRates.current?.read(turnId) ?? null;
  const readHasOutputRate = () => readOutputRate() !== null;
  const hasOutputRate = useSyncExternalStore(store.subscribe, readHasOutputRate, readHasOutputRate);
  const toolCalls = useMemo(() => {
    const { itemStoresByKey } = store.getState();
    // 工具、命令和文件修改共用回合条目身份，多次更新同一调用只计一次。
    return (itemKeys ?? []).reduce((count, key) => {
      const type = itemStoresByKey.get(key)?.peek().type;
      return type === "tool" || type === "command" || type === "file_change" ? count + 1 : count;
    }, 0);
  }, [store, itemKeys]);
  const { isRunning, totalSeconds } = useTurnProcessingTime(turn ?? idleTiming);
  if (!isRunning) return null;

  const duration = totalSeconds === null ? null : formatTurnProcessingDuration(totalSeconds);
  // 状态项以输入框为基准整体居中，窄屏换行时每行也保持居中。
  return (
    <div
      className="mb-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-2 text-xs leading-5 text-muted-foreground tabular-nums"
      data-turn-generation-status=""
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <AgentEngineIcon engine={engine} />
        {generatingLabel}
      </span>
      {duration === null ? null : (
        <span className="whitespace-nowrap">
          <span aria-hidden="true">· </span>
          <time dateTime={duration.dateTime}>{duration.label}</time>
        </span>
      )}
      <span className="whitespace-nowrap">
        <span aria-hidden="true">· </span>
        {toolCallsLabel(toolCalls)}
      </span>
      <TurnOutputRateLabel rate={hasOutputRate ? readOutputRate() : null} />
    </div>
  );
}
