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
    // 终态与 SSR 不建立订阅，运行中的回合继续按秒读取速率，完成或卸载时释放共享资源。
    if (!isRunning || typeof document === "undefined") return;
    return subscribeTurnProcessingClock(setNow);
  }, [isRunning, startedAt]);

  // 等待首批输出以及输出暂停时保留速率位置，避免数字反复消失。
  return { ...result, outputRate: isRunning ? (readOutputRate?.(now) ?? 0) : null };
}

/** 速率以一位小数展示，数字和单位保持同行。 */
export function TurnOutputRateLabel({ rate }: Readonly<{ rate: number | null }>) {
  if (rate === null) return null;
  // 一位小数会把 999.95 进位为四位数，从该阈值起缩写，避免数字变宽推移后方控件。
  const value = rate >= 999.95 ? `${(rate / 1_000).toFixed(1)}k` : rate.toFixed(1);
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden="true">· </span>
      <span className="inline-block min-w-[8ch] text-right">{value} t/s</span>
    </span>
  );
}
