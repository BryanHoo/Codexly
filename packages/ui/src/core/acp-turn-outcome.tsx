import { CircleAlert } from "lucide-react";
import { memo, useMemo, useSyncExternalStore } from "react";
import type { AcpSessionState, AgentTurn } from "@codexly/protocol";
import { InspectorSection } from "./inspector-section.js";

type Turn = Pick<AgentTurn, "acpBackground" | "status" | "stopReason">;
type Source = Readonly<{
  getState: () => Readonly<{
    projectId: string;
    taskId: string;
    snapshotMetadata: Readonly<{ runtime?: "acp"; acpSession?: AcpSessionState }> | null;
    turnIds: readonly string[];
    turnsById: Readonly<Record<string, Turn>>;
  }>;
  subscribe: (listener: () => void) => () => void;
}>;

const labels = {
  zh: {
    title: "回合详情",
    max_tokens: "已达到 Token 上限",
    max_turn_requests: "已达到模型请求次数上限",
    refusal: "Agent 拒绝继续",
  },
  en: {
    title: "Turn details",
    max_tokens: "Token limit reached",
    max_turn_requests: "Model request limit reached",
    refusal: "Agent refused to continue",
  },
} as const;

function createStopReasonReader(source: Source, projectId: string, taskId: string) {
  let turnIds: readonly string[] | undefined;
  let turnsById: ReturnType<Source["getState"]>["turnsById"] | undefined;
  let stopReason: string | undefined;
  return () => {
    const state = source.getState();
    const metadata = state.snapshotMetadata;
    if (state.projectId !== projectId || state.taskId !== taskId) return undefined;
    if (metadata?.runtime !== "acp" && !metadata?.acpSession) return undefined;

    // 流式正文沿用同一套回合索引。只有索引变化时才查找最近的前台回合。
    if (turnIds !== state.turnIds || turnsById !== state.turnsById) {
      turnIds = state.turnIds;
      turnsById = state.turnsById;
      stopReason = undefined;
      for (let index = turnIds.length - 1; index >= 0; index--) {
        const id = turnIds[index];
        const turn = id === undefined ? undefined : turnsById[id];
        if (!turn || turn.acpBackground) continue;
        if (turn.status !== "running") stopReason = turn.stopReason;
        break;
      }
    }
    return stopReason;
  };
}

export const AcpTurnOutcome = memo(function AcpTurnOutcome({
  source,
  projectId,
  taskId,
  language,
}: Readonly<{ source: Source; projectId: string; taskId: string; language: string }>) {
  const read = useMemo(
    () => createStopReasonReader(source, projectId, taskId),
    [source, projectId, taskId],
  );
  const reason = useSyncExternalStore(source.subscribe, read, read);
  // 时间线已经展示常规回合状态，右栏仅补充可以解释中止的 ACP 原因。
  if (reason !== "max_tokens" && reason !== "max_turn_requests" && reason !== "refusal")
    return null;
  const t = language.startsWith("zh") ? labels.zh : labels.en;
  return (
    <InspectorSection
      title={t.title}
      icon={<CircleAlert aria-hidden="true" className="size-3.5" />}
    >
      <p className="break-words py-1.5 pr-2 pl-5.5 text-label leading-5 text-foreground">
        {t[reason]}
      </p>
    </InspectorSection>
  );
});
