import { TurnProcessHistory } from "./task-timeline-lazy-process.js";
import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import { Message } from "../../../shared/components/agent/message.js";
import type { NormalizedAgentTurn, TaskStore } from "../../conversation/runtime/task-store.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { BuildPlanAction, ForkTaskAction } from "./task-timeline-contracts.js";
import { ChangedFilesCard } from "./task-timeline-file-changes.js";
import { StoredAssistantTimelineItems } from "./task-timeline-store-operation-groups.js";
import { StoredRunningReplyStatus } from "./task-timeline-store-items.js";
import { MessageMetadata, TurnProcessingTime } from "./task-timeline-status.js";

export function StoredAssistantGroup({
  itemKeys,
  lastTurnItemKey,
  onOpenFileDiff,
  onForkTask,
  onBuildPlan,
  onOpenSourceFile,
  onReviewFileChanges,
  onToggleProcess,
  processExpanded,
  processTurns,
  processItemKeys,
  paginatedProcessItemKeys,
  processToggleAvailable,
  projectId,
  showProcessingTime,
  showRunningShimmer,
  store,
  taskId,
  turn,
}: Readonly<{
  itemKeys: readonly string[];
  lastTurnItemKey: string | undefined;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onForkTask?: ForkTaskAction;
  onBuildPlan?: BuildPlanAction;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onToggleProcess: () => void;
  processExpanded: boolean;
  processTurns: readonly NormalizedAgentTurn[];
  processItemKeys: ReadonlySet<string>;
  paginatedProcessItemKeys: ReadonlySet<string>;
  processToggleAvailable: boolean;
  projectId: string;
  showProcessingTime: boolean;
  showRunningShimmer: boolean;
  store: TaskStore;
  taskId: string;
  turn: NormalizedAgentTurn;
}>) {
  // 完成态聚合只在 Turn 终态或 Item 顺序变化时执行，不参与文本 Delta。
  const itemStoresByKey = store.getState().itemStoresByKey;
  const assistantTextParts: string[] = [];
  const responseFileChanges: AgentFileChange[] = [];
  const visibleItemKeys = itemKeys.filter(
    (key) => !paginatedProcessItemKeys.has(key) && (processExpanded || !processItemKeys.has(key)),
  );
  if (turn.status !== "running") {
    for (const itemKey of visibleItemKeys) {
      const item = itemStoresByKey.get(itemKey)?.read();
      if (item?.type === "message" && item.role === "assistant") {
        assistantTextParts.push(item.text);
      } else if (item?.type === "file_change" && item.status === "completed") {
        responseFileChanges.push(...item.changes);
      }
    }
  }
  const assistantText = assistantTextParts.join("\n\n");
  return (
    <Message from="assistant">
      {showProcessingTime ? (
        <TurnProcessingTime
          status={turn.status}
          completedAt={turn.completedAt}
          startedAt={turn.startedAt}
          {...(processToggleAvailable
            ? { expanded: processExpanded, onToggle: onToggleProcess }
            : {})}
        />
      ) : null}
      {showProcessingTime
        ? processTurns.map((sourceTurn) => (
            <TurnProcessHistory
              key={sourceTurn.id}
              expanded={processExpanded}
              initialCursor={sourceTurn.processCursor ?? ""}
              projectId={projectId}
              taskId={taskId}
              turnId={sourceTurn.id}
              onOpenFileDiff={onOpenFileDiff}
              onOpenSourceFile={onOpenSourceFile}
            />
          ))
        : null}
      {visibleItemKeys.length > 0 || showRunningShimmer ? (
        <div className="agent-timeline">
          <StoredAssistantTimelineItems
            itemKeys={visibleItemKeys}
            itemTimings={turn.itemTimings}
            lastTurnItemKey={lastTurnItemKey}
            {...(onBuildPlan === undefined ? {} : { onBuildPlan })}
            onOpenFileDiff={onOpenFileDiff}
            onOpenSourceFile={onOpenSourceFile}
            projectId={projectId}
            store={store}
            taskId={taskId}
            turnStatus={turn.status}
          />
          {showRunningShimmer ? (
            <StoredRunningReplyStatus itemKeys={itemKeys} store={store} />
          ) : null}
        </div>
      ) : null}
      {turn.status !== "running" && responseFileChanges.length > 0 ? (
        <ChangedFilesCard
          changes={responseFileChanges}
          onOpenFileDiff={onOpenFileDiff}
          onReviewFileChanges={onReviewFileChanges}
        />
      ) : null}
      {turn.status !== "running" && assistantText.trim().length > 0 ? (
        <MessageMetadata
          lastTurnId={turn.id}
          {...(onForkTask === undefined || turn.forkable === false ? {} : { onForkTask })}
          text={assistantText}
        />
      ) : null}
    </Message>
  );
}
