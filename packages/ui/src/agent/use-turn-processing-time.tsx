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
    // 终态、无效时间和 SSR 不建立订阅；完成或卸载时释放共享资源。
    if (!isRunning || typeof document === "undefined") return;
    return subscribeTurnProcessingClock(setNow);
  }, [isRunning, startedAt]);

  return result;
}
