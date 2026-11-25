import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AgentEngine } from "@codexly/protocol";
import type { TaskViewStoreState } from "@codexly/frontend-core/task-view-selectors";
import type { TurnOutputRates } from "@codexly/frontend-core/turn-output-rate";
import {
  formatTurnProcessingDuration,
  type TurnProcessingTiming,
} from "@codexly/frontend-core/turn-processing-time";

import { AgentEngineIcon } from "../core/agent-engine-icon.js";
import { subscribeTurnProcessingClock } from "./turn-processing-clock.js";
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

function TurnGenerationRate({
  store,
  turnId,
}: Readonly<{ store: GenerationStore; turnId: string }>) {
  const [rate, setRate] = useState(
    () => store.getState().turnOutputRates.current?.read(turnId) ?? null,
  );
  useEffect(() => {
    const read = () => store.getState().turnOutputRates.current?.read(turnId) ?? null;
    let displayed = read();
    setRate(displayed);
    // 首个有效读数立刻显示。之后复用秒级时钟刷新数值，正文更新仅检查显隐。
    const unsubscribe = store.subscribe(() => {
      const current = read();
      if ((current === null) === (displayed === null)) return;
      displayed = current;
      setRate(current);
    });
    const stopClock = subscribeTurnProcessingClock(() => {
      displayed = read();
      setRate(displayed);
    });
    return () => {
      unsubscribe();
      stopClock();
    };
  }, [store, turnId]);

  return <TurnOutputRateLabel rate={rate} />;
}

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
      <TurnGenerationRate key={turnId} store={store} turnId={turnId} />
    </div>
  );
}
