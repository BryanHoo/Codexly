import { useEffect, useState } from "react";
import {
  resolveTurnProcessingTime,
  type TurnProcessingTiming,
} from "@codexly/frontend-core/turn-processing-time";
import { TurnOutputRates } from "@codexly/frontend-core/turn-output-rate";

import { subscribeTurnProcessingClock } from "./turn-processing-clock.js";

export function useTurnOutputRateSampling(rates: { current?: TurnOutputRates }) {
  useEffect(() => {
    // 同一任务的分屏复用 Store 上的计量器，React 重挂载时不丢弃已有样本。
    rates.current ??= new TurnOutputRates();
  }, [rates]);
}

/** 两端共用展示时钟；仅暂停界面刷新，回合实际耗时始终由绝对时间推导。 */
export function useTurnProcessingTime(
  timing: TurnProcessingTiming,
  readOutputRate?: (nowMs: number) => number | null,
) {
  const [now, setNow] = useState(Date.now);
  const result = resolveTurnProcessingTime(timing, now);
  const { isRunning } = result;
  const { startedAt } = timing;

  useEffect(() => {
    // 终态、无效时间和 SSR 不建立订阅；完成或卸载时释放共享资源。
    if (!isRunning || typeof document === "undefined") return;
    return subscribeTurnProcessingClock(setNow);
  }, [isRunning, startedAt]);

  return { ...result, outputRate: isRunning ? (readOutputRate?.(now) ?? null) : null };
}

/** 「≈」标识流式文本估算，数字和单位保持同行。 */
export function TurnOutputRateLabel({ rate }: Readonly<{ rate: number | null }>) {
  return rate === null ? null : (
    <span className="whitespace-nowrap">
      <span aria-hidden="true">· </span>≈{rate.toFixed(1)} t/s
    </span>
  );
}
