import type { AgentTurn } from "@codexly/protocol";

export type TurnProcessingTiming = Pick<AgentTurn, "status" | "startedAt" | "completedAt">;

/** 两端以回合状态决定是否走时，空结束时间仅表示时间未知，不能证明回合仍在执行。 */
export function resolveTurnProcessingTime(
  { status, startedAt, completedAt }: TurnProcessingTiming,
  nowMs: number,
): Readonly<{ isRunning: boolean; totalSeconds: number | null }> {
  const startedAtMs = startedAt === null ? Number.NaN : Date.parse(startedAt);
  const isRunning = status === "running" && completedAt === null && Number.isFinite(startedAtMs);
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
