import { useEffect, useState } from "react";
import {
  resolveTurnProcessingTime,
  type TurnProcessingTiming,
} from "@codexly/frontend-core/turn-processing-time";

import { subscribeTurnProcessingClock } from "./turn-processing-clock.js";

/** 两端共用展示时钟；仅暂停界面刷新，回合实际耗时始终由绝对时间推导。 */
export function useTurnProcessingTime(timing: TurnProcessingTiming) {
  const [now, setNow] = useState(Date.now);
  const result = resolveTurnProcessingTime(timing, now);
  const { isRunning } = result;
  const { startedAt } = timing;

  useEffect(() => {
    // 终态与 SSR 不建立订阅，运行中的回合按秒刷新，完成或卸载时释放共享资源。
    if (!isRunning || typeof document === "undefined") return;
    return subscribeTurnProcessingClock(setNow);
  }, [isRunning, startedAt]);

  return result;
}

/** 速率以一位小数展示，数字和单位保持同行。 */
export function TurnOutputRateLabel({ rate }: Readonly<{ rate: number | null }>) {
  // 缺少采样时隐藏整项，分隔点随速率一起出现。
  if (rate === null) return null;
  // 从 999.95 起缩写以避免进位后显示四位整数。
  const value = rate >= 999.95 ? `${(rate / 1_000).toFixed(1)}k` : rate.toFixed(1);
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden="true">· </span>
      {value} t/s
    </span>
  );
}
