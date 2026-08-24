import type { PendingRequest } from "@code-agent/protocol";
import { AlertTriangle, Info } from "lucide-react";
import { useState } from "react";
import { useStore } from "zustand";

import { i18n } from "../../../i18n/i18n.js";

import {
  Conversation,
  ConversationScrollButton,
  ConversationVirtualList,
} from "../../../shared/components/agent/conversation.js";
import { Message, type MessageFileReference } from "../../../shared/components/agent/message.js";
import type {
  NormalizedAgentTurn,
  TaskNotice,
  TaskStore,
} from "../../conversation/runtime/task-store.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { PendingRequestCard, type PendingRequestResolution } from "./pending-request.js";

import type { BuildPlanAction, ForkTaskAction } from "./task-timeline-contracts.js";
import { ChangedFilesCard } from "./task-timeline-file-changes.js";
import { resolveCompletedTurnProcessItemIds } from "./task-timeline-process.js";
import { TaskTimelinePagination } from "./task-timeline-pagination.js";
import { RunningReplyStatus } from "./task-timeline-running.js";
import { StoredAssistantTimelineItems } from "./task-timeline-store-operation-groups.js";
import {
  StoredRunningReplyStatus,
  StoredUserMessage,
  groupStoredTurnTimelineItems,
} from "./task-timeline-store-items.js";
import {
  MessageMetadata,
  TimelineState,
  TurnProcessingTime,
  getMessageTimestamp,
} from "./task-timeline-status.js";

const getTurnIdKey = (turnId: string) => turnId;
export function StoredAssistantGroup({
  itemKeys,
  lastTurnItemKey,
  latestSnapshotTimestamp,
  onOpenFileDiff,
  onForkTask,
  onBuildPlan,
  onOpenSourceFile,
  onReviewFileChanges,
  onToggleProcess,
  processExpanded,
  processItemKeys,
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
  latestSnapshotTimestamp: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onForkTask?: ForkTaskAction;
  onBuildPlan?: BuildPlanAction;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onToggleProcess: () => void;
  processExpanded: boolean;
  processItemKeys: ReadonlySet<string>;
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
  const visibleItemKeys =
    turn.status === "running" || processExpanded
      ? itemKeys
      : itemKeys.filter((itemKey) => !processItemKeys.has(itemKey));
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
          completedAt={turn.completedAt}
          startedAt={turn.startedAt}
          {...(processToggleAvailable
            ? { expanded: processExpanded, onToggle: onToggleProcess }
            : {})}
        />
      ) : null}
      {visibleItemKeys.length > 0 || showRunningShimmer ? (
        <div className="w-full space-y-4">
          <StoredAssistantTimelineItems
            itemKeys={visibleItemKeys}
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
          {...(onForkTask === undefined ? {} : { onForkTask })}
          text={assistantText}
          timestamp={getMessageTimestamp("assistant", turn, latestSnapshotTimestamp)}
        />
      ) : null}
    </Message>
  );
}

export function StoreTurnTimelineSection({
  onBuildPlan,
  onForkTask,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  projectId,
  store,
  taskId,
  turnId,
  turnIndex,
  suppressEmptyRunningStatus,
}: Readonly<{
  onBuildPlan?: BuildPlanAction;
  onForkTask?: ForkTaskAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  projectId: string;
  store: TaskStore;
  taskId: string;
  turnId: string;
  turnIndex: number;
  suppressEmptyRunningStatus: boolean;
}>) {
  const turn = useStore(store, (state) => state.turnsById[turnId]);
  const itemKeys = useStore(store, (state) => state.itemKeysByTurnId[turnId] ?? []);
  const [processExpanded, setProcessExpanded] = useState(false);
  if (turn === undefined) {
    return null;
  }
  const latestSnapshotTimestamp = store.getState().snapshotMetadata?.updatedAt ?? "";
  const itemStoresByKey = store.getState().itemStoresByKey;
  const timelineGroups = groupStoredTurnTimelineItems(itemKeys, itemStoresByKey);
  const processNativeItemIds = new Set(
    resolveCompletedTurnProcessItemIds(
      itemKeys.flatMap((itemKey) => itemStoresByKey.get(itemKey)?.peek() ?? []),
      turn.status,
    ),
  );
  const processItemKeys = new Set(
    itemKeys.filter((itemKey) =>
      processNativeItemIds.has(itemStoresByKey.get(itemKey)?.peek().id ?? ""),
    ),
  );
  const processToggleAvailable = processItemKeys.size > 0;
  const firstAssistantGroupIndex = timelineGroups.findIndex((group) => group.type === "assistant");
  const hasAssistantItems = firstAssistantGroupIndex >= 0;
  const lastTurnItemKey = itemKeys.at(-1);

  return (
    <section
      aria-label={`Turn ${String(turnIndex + 1)}`}
      className="space-y-4"
      data-status={turn.status}
    >
      {timelineGroups.map((group, groupIndex) =>
        group.type === "user" ? (
          <StoredUserMessage
            itemKey={group.itemKey}
            key={group.itemKey}
            latestSnapshotTimestamp={latestSnapshotTimestamp}
            onOpenFileDiff={onOpenFileDiff}
            onOpenSourceFile={onOpenSourceFile}
            projectId={projectId}
            store={store}
            taskId={taskId}
            turn={turn}
          />
        ) : (
          <StoredAssistantGroup
            itemKeys={group.itemKeys}
            key={group.key}
            lastTurnItemKey={lastTurnItemKey}
            latestSnapshotTimestamp={latestSnapshotTimestamp}
            {...(turn.status === "completed" && onBuildPlan !== undefined ? { onBuildPlan } : {})}
            onOpenFileDiff={onOpenFileDiff}
            onToggleProcess={() => {
              setProcessExpanded((expanded) => !expanded);
            }}
            {...(turn.status !== "running" && onForkTask !== undefined ? { onForkTask } : {})}
            onOpenSourceFile={onOpenSourceFile}
            onReviewFileChanges={onReviewFileChanges}
            projectId={projectId}
            processExpanded={processExpanded}
            processItemKeys={processItemKeys}
            processToggleAvailable={processToggleAvailable}
            showProcessingTime={groupIndex === firstAssistantGroupIndex}
            showRunningShimmer={
              turn.status === "running" && groupIndex === timelineGroups.length - 1
            }
            store={store}
            taskId={taskId}
            turn={turn}
          />
        ),
      )}
      {turn.status === "running" && !hasAssistantItems && !suppressEmptyRunningStatus ? (
        <Message from="assistant">
          <TurnProcessingTime completedAt={turn.completedAt} startedAt={turn.startedAt} />
          <div className="w-full space-y-4">
            <RunningReplyStatus />
          </div>
        </Message>
      ) : null}
      {turn.error === null ? null : (
        <div
          className="rounded-surface bg-control px-3 py-2 text-label leading-5 text-danger"
          role="alert"
        >
          <p>{turn.error}</p>
        </div>
      )}
    </section>
  );
}

function TaskNoticeRow({ notice }: Readonly<{ notice: TaskNotice }>) {
  const isWarning = notice.payload.level === "warning";
  const message =
    notice.payload.code === "model_verification"
      ? i18n.t("timeline.notice.modelVerification", { ns: "conversation" })
      : notice.payload.code === "strict_review_required"
        ? i18n.t("timeline.notice.strictReviewRequired", { ns: "conversation" })
        : notice.payload.message;
  const title = i18n.t(`timeline.notice.${notice.payload.code}`, { ns: "conversation" });

  return (
    <div
      className={`flex items-start gap-2 border-l-2 px-3 py-2 text-label leading-5 ${
        isWarning ? "border-warning text-warning" : "border-separator-strong text-muted-foreground"
      }`}
      role={isWarning ? "alert" : "status"}
    >
      {isWarning ? (
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="break-words">{message}</p>
      </div>
    </div>
  );
}

export function StoreTaskNoticeList({ store }: Readonly<{ store: TaskStore }>) {
  const notices = useStore(store, (state) => state.notices);
  return notices.map((notice) => (
    <TaskNoticeRow key={`${notice.sessionId}:${String(notice.sequence)}`} notice={notice} />
  ));
}

export function StorePendingRequestList({
  connected,
  onResolvePendingRequest,
  store,
}: Readonly<{
  connected: boolean;
  onResolvePendingRequest: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  store: TaskStore;
}>) {
  const pendingRequestIds = useStore(store, (state) => state.pendingRequestIds);
  const pendingRequestsById = useStore(store, (state) => state.pendingRequestsById);
  const visiblePendingRequests = pendingRequestIds.flatMap((requestId) => {
    const request = pendingRequestsById[requestId];
    return request === undefined || request.status === "resolved" ? [] : [request];
  });
  const firstPendingIndex = visiblePendingRequests.findIndex(
    (request) => request.status === "pending",
  );

  return visiblePendingRequests.map((request, index) => (
    <PendingRequestCard
      interactive={connected && request.status === "pending" && index === firstPendingIndex}
      key={request.requestId}
      onResolve={onResolvePendingRequest}
      request={request}
    />
  ));
}

export function TaskStoreTimeline({
  connected,
  hasOlderHistory = false,
  isLoadingOlderHistory = false,
  onBuildPlan,
  onForkTask,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  onResolvePendingRequest,
  onLoadOlderHistory = () => Promise.resolve(),
  olderHistoryError = null,
  scrollToBottomSignal,
  store,
  submissionStartedAt,
  submissionTurnId,
}: Readonly<{
  connected: boolean;
  hasOlderHistory?: boolean;
  isLoadingOlderHistory?: boolean;
  onBuildPlan?: BuildPlanAction;
  onForkTask?: ForkTaskAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onResolvePendingRequest: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  onLoadOlderHistory?: () => Promise<void>;
  olderHistoryError?: Error | null;
  scrollToBottomSignal?: number;
  store: TaskStore;
  submissionStartedAt?: string;
  submissionTurnId?: string;
}>) {
  const projectId = store.getState().projectId;
  const taskId = store.getState().taskId;
  const turnIds = useStore(store, (state) => state.turnIds);
  const pendingRequestIds = useStore(store, (state) => state.pendingRequestIds);
  const pendingRequestsById = useStore(store, (state) => state.pendingRequestsById);
  const notices = useStore(store, (state) => state.notices);
  const hasVisiblePendingRequest = pendingRequestIds.some(
    (requestId) => pendingRequestsById[requestId]?.status !== "resolved",
  );
  const submissionHandoffState = useStore(store, (state) => {
    if (submissionTurnId === undefined) {
      return "awaiting-turn";
    }
    const turn = state.turnsById[submissionTurnId];
    if (turn === undefined) {
      return "awaiting-turn";
    }
    const groups = groupStoredTurnTimelineItems(
      state.itemKeysByTurnId[submissionTurnId] ?? [],
      state.itemStoresByKey,
    );
    if (groups.some((group) => group.type === "assistant")) {
      return "assistant-started";
    }
    // completed Snapshot 可能先于 Assistant Item 落盘，只有失败或中断才能提前结束本地提交态。
    return turn.status === "failed" || turn.status === "interrupted"
      ? "finished"
      : "awaiting-assistant";
  });
  // HTTP 返回不代表回复已经可见；首个 Assistant Item 到达前由稳定尾部持续承载运行态。
  const showPendingSubmission =
    submissionStartedAt !== undefined &&
    (submissionHandoffState === "awaiting-turn" || submissionHandoffState === "awaiting-assistant");
  const hasNotices = notices.length > 0;
  if (
    turnIds.length === 0 &&
    !hasVisiblePendingRequest &&
    !showPendingSubmission &&
    !hasNotices &&
    !hasOlderHistory
  ) {
    return (
      <TimelineState message={i18n.t("timeline.noHistory", { ns: "conversation" })} role="status" />
    );
  }
  return (
    <Conversation
      aria-label={i18n.t("timeline.conversation", { ns: "conversation" })}
      conversationId={`${projectId}:${taskId}`}
      {...(scrollToBottomSignal === undefined ? {} : { scrollToBottomSignal })}
    >
      {hasOlderHistory ? (
        <TaskTimelinePagination
          error={olderHistoryError}
          isLoading={isLoadingOlderHistory}
          onLoad={onLoadOlderHistory}
        />
      ) : null}
      <ConversationVirtualList
        {...(hasVisiblePendingRequest || showPendingSubmission || hasNotices
          ? {
              footer: (
                <>
                  {hasNotices ? <StoreTaskNoticeList store={store} /> : null}
                  {hasVisiblePendingRequest ? (
                    <StorePendingRequestList
                      connected={connected}
                      onResolvePendingRequest={onResolvePendingRequest}
                      store={store}
                    />
                  ) : null}
                  {showPendingSubmission ? (
                    <Message from="assistant">
                      <TurnProcessingTime completedAt={null} startedAt={submissionStartedAt} />
                      <RunningReplyStatus />
                    </Message>
                  ) : null}
                </>
              ),
            }
          : {})}
        getItemKey={getTurnIdKey}
        items={turnIds}
        renderItem={(turnId, turnIndex) => (
          <StoreTurnTimelineSection
            {...(connected && turnId === turnIds.at(-1) && onBuildPlan !== undefined
              ? { onBuildPlan }
              : {})}
            {...(connected && onForkTask !== undefined ? { onForkTask } : {})}
            onOpenFileDiff={onOpenFileDiff}
            onOpenSourceFile={onOpenSourceFile}
            onReviewFileChanges={onReviewFileChanges}
            projectId={projectId}
            store={store}
            taskId={taskId}
            turnId={turnId}
            turnIndex={turnIndex}
            suppressEmptyRunningStatus={showPendingSubmission && turnId === submissionTurnId}
          />
        )}
      />
      <ConversationScrollButton />
    </Conversation>
  );
}
