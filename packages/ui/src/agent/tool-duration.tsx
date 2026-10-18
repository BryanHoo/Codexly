import type { AgentItemStatus, AgentTurn } from "@codexly/protocol";
import { useEffect, useRef, useState } from "react";

import { subscribeVisibleToolClock } from "./tool-duration-clock.js";

type ToolTiming = NonNullable<AgentTurn["itemTimings"]>[string];

export function formatToolDuration(
  timing: ToolTiming | undefined,
  nowMs?: number,
): string | undefined {
  if (timing?.startedAtMs === undefined) return undefined;
  const completedAtMs = timing.completedAtMs ?? nowMs;
  if (completedAtMs === undefined) return undefined;
  const durationMs = completedAtMs - timing.startedAtMs;
  if (!Number.isFinite(durationMs) || durationMs < 0) return undefined;
  return durationMs < 1_000
    ? `${String(durationMs)}ms`
    : `${String(Math.round(durationMs / 100) / 10)}s`;
}

export function ToolDuration({
  status,
  timing,
}: Readonly<{ status: AgentItemStatus; timing: ToolTiming }>) {
  const [nowMs, setNowMs] = useState(Date.now);
  const elementRef = useRef<HTMLSpanElement>(null);
  const isRunning = status === "running" && timing.completedAtMs === undefined;
  const duration = formatToolDuration(timing, isRunning ? nowMs : undefined);
  const hasDuration = duration !== undefined;

  useEffect(() => {
    const element = elementRef.current;
    if (!isRunning || !hasDuration || element === null) return;
    // 仅运行且有有效耗时的节点登记观察；完成、失效或卸载时立即退订。
    return subscribeVisibleToolClock(element, setNowMs);
  }, [hasDuration, isRunning, timing.startedAtMs]);

  return duration === undefined ? null : (
    <span
      ref={elementRef}
      className="min-w-[6ch] shrink-0 text-right tabular-nums text-caption text-muted-foreground"
      data-tool-duration=""
    >
      {duration}
    </span>
  );
}
