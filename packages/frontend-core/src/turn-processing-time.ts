import type { AgentTurn } from "@codexly/protocol";

export type TurnProcessingTiming = Pick<AgentTurn, "status" | "startedAt" | "completedAt">;

/** 两端以回合状态决定是否走时，空结束时间仅表示时间未知，不能证明回合仍在执行。 */
export function resolveTurnProcessingTime(
  { status, startedAt, completedAt }: TurnProcessingTiming,
  nowMs: number,
): Readonly<{ isRunning: boolean; totalSeconds: number | null }> {
  const startedAtMs = startedAt === null ? Number.NaN : Date.parse(startedAt);
  // 起始时间缺失时仍保留运行状态，耗时单独显示为未知。
  const isRunning = status === "running" && completedAt === null;
  // 异常退出后的终态可能没有可靠结束时间；不把离线时长或恢复页面的时间算作处理耗时。
  const endedAtMs =
    completedAt === null ? (isRunning ? nowMs : Number.NaN) : Date.parse(completedAt);
  return {
    isRunning,
    totalSeconds:
      Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs)
        ? Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1_000))
        : null,
  };
}

/** 共享输入框状态行和执行过程标题的紧凑耗时格式。 */
export function formatTurnProcessingDuration(totalSeconds: number): Readonly<{
  dateTime: string;
  label: string;
}> {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return {
    dateTime: `PT${hours > 0 ? `${String(hours)}H` : ""}${minutes > 0 ? `${String(minutes)}M` : ""}${String(seconds)}S`,
    label:
      hours > 0
        ? `${String(hours)}h ${String(minutes)}m ${String(seconds)}s`
        : minutes > 0
          ? `${String(minutes)}m ${String(seconds)}s`
          : `${String(seconds)}s`,
  };
}
