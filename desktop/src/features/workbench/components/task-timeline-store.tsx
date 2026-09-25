import { HistoryNavigation, type HistoryAnchor } from "../../search/history-navigation.js";
import type { PendingRequest } from "@/protocol/index.js";
import { Info } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useStore } from "zustand";
import { i18n } from "../../../i18n/i18n.js";
import { ConversationList } from "../../../shared/components/agent/conversation.js";
import { Message, type MessageFileReference } from "../../../shared/components/agent/message.js";
import type {
  NormalizedAgentTurn,
  TaskNotice,
  TaskStore,
} from "../../conversation/runtime/task-store.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { PendingRequestCard, type PendingRequestResolution } from "./pending-request.js";
import type { BuildPlanAction, ForkTaskAction } from "./task-timeline-contracts.js";
import { useTurnSizeEstimate } from "./task-timeline-estimate.js";
import { ChangedFilesCard } from "./task-timeline-file-changes.js";
import { resolveCompletedTurnProcessItemIds } from "./task-timeline-process.js";
import { TaskTimelinePagination } from "./task-timeline-pagination.js";
import {
  TaskTimelineNavigation,
  getTaskTimelineNavigationItems,
} from "./task-timeline-navigation.js";
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

export const StoreTurnTimelineSection = memo(function StoreTurnTimelineSection({
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
  pendingSubmission,
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
  pendingSubmission: boolean;
}>) {
  const turn = useStore(store, (state) => state.turnsById[turnId]);
  const itemKeys = useStore(store, (state) => state.itemKeysByTurnId[turnId] ?? []);
  const [processExpanded, setProcessExpanded] = useState(false);
  if (turn === undefined) {
    return null;
  }
  const latestSnapshotTimestamp = store.getState().snapshotMetadata?.updatedAt ?? "";
  const itemStoresByKey = store.getState().itemStoresByKey;
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
  // 折叠项必须在分组前移除，否则隐藏的引导仍会切断最终答复与文件审核卡片。
  const hiddenProcessItemKeys =
    turn.status === "running" || processExpanded ? undefined : processItemKeys;
  const timelineGroups = groupStoredTurnTimelineItems(
    itemKeys,
    itemStoresByKey,
    hiddenProcessItemKeys,
  );
  const processToggleAvailable = processItemKeys.size > 0;
  const firstAssistantGroupIndex = timelineGroups.findIndex((group) => group.type === "assistant");
  const hasAssistantItems = firstAssistantGroupIndex >= 0;
  const lastTurnItemKey = itemKeys.at(-1);

  return (
    <section
      aria-label={`Turn ${turnIndex + 1}`}
      className="space-y-4"
      data-status={turn.status}
    >
      {timelineGroups.map((group, groupIndex) =>
        group.type === "user" ? (
          <StoredUserMessage
            itemKey={group.itemKey}
            // 首条输入从本地占位切换为权威 ID 时保留气泡节点，避免重新挂载 Markdown。
            key={groupIndex === 0 ? turn.id : group.itemKey}
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
      {((turn.status === "running" && itemKeys.length > 0) || pendingSubmission) && !hasAssistantItems ? (
        <Message from="assistant">
          <TurnProcessingTime completedAt={null} startedAt={turn.startedAt} />
          <RunningReplyStatus />
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
});

function TaskInfoNotice({ notice }: Readonly<{ notice: TaskNotice }>) {
  const message = notice.payload.message;
  const title = i18n.t(`timeline.notice.${notice.payload.code}`, { ns: "conversation" });
  return (
    <div className="flex items-start gap-2 border-l-2 border-separator-strong px-3 py-2 text-label leading-5 text-muted-foreground" role="status">
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="break-words">{message}</p>
      </div>
    </div>
  );
}

export function getTimelineNotices(notices: readonly TaskNotice[]): readonly TaskNotice[] {
  return notices.filter((notice) => notice.payload.level !== "warning");
}

function StoreTaskInfoNotices({ notices }: Readonly<{ notices: readonly TaskNotice[] }>) {
  return notices.map((notice) => (
    <TaskInfoNotice key={`${notice.sessionId}:${String(notice.sequence)}`} notice={notice} />
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
    return request === undefined || (request.status === "resolved" && request.type !== "plugin_install_suggestion") ? [] : [request];
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
  searchTarget,
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
  searchTarget?: HistoryAnchor;
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
  const itemStructureRevision = useStore(store, (state) => state.itemStructureRevision);
  const pendingRequestIds = useStore(store, (state) => state.pendingRequestIds);
  const pendingRequestsById = useStore(store, (state) => state.pendingRequestsById);
  const notices = useStore(store, (state) => state.notices);
  const hasVisiblePendingRequest = pendingRequestIds.some(
    (requestId) => pendingRequestsById[requestId]?.status !== "resolved",
  );
  const navigationItems = useMemo(() => {
    // Store 内部 Map 保持引用稳定，以 revision 作为 Item 结构变化的重算信号。
    void itemStructureRevision;
    return getTaskTimelineNavigationItems(store.getState());
  }, [itemStructureRevision, store]);
  const estimateTurnSize = useTurnSizeEstimate(store, itemStructureRevision);
  const submissionHandoffState = useStore(store, (state) => {
    if (submissionTurnId === undefined) {
      return "footer";
    }
    const turn = state.turnsById[submissionTurnId];
    if (turn === undefined || !state.itemKeysByTurnId[submissionTurnId]?.length) {
      return "footer";
    }
    const groups = groupStoredTurnTimelineItems(
      state.itemKeysByTurnId[submissionTurnId] ?? [],
      state.itemStoresByKey,
    );
    // completed Snapshot 可能先于 Assistant Item 落盘，只有失败或中断才能提前结束本地提交态。
    return groups.some((group) => group.type === "assistant") || turn.status === "failed" || turn.status === "interrupted"
      ? undefined
      : "turn";
  });
  // 已知回合内同时布局输入、时间与运行态，避免独立虚拟尾部二次测量将输入顶走。
  const showPendingSubmission =
    submissionStartedAt !== undefined &&
    submissionHandoffState !== undefined;
  const showPendingFooter = showPendingSubmission && submissionHandoffState === "footer";
  const timelineNotices = getTimelineNotices(notices);
  const hasNotices = timelineNotices.length > 0;
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
    <ConversationList
      aria-label={i18n.t("timeline.conversation", { ns: "conversation" })}
      conversationId={`${projectId}:${taskId}`}
      estimateItemSize={estimateTurnSize}
      {...(hasVisiblePendingRequest || showPendingFooter || hasNotices
        ? {
            footer: (
              <>
                {hasNotices ? <StoreTaskInfoNotices notices={timelineNotices} /> : null}
                {hasVisiblePendingRequest ? (
                  <StorePendingRequestList
                    connected={connected}
                    onResolvePendingRequest={onResolvePendingRequest}
                    store={store}
                  />
                ) : null}
                {showPendingFooter ? (
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
      {...(hasOlderHistory
        ? {
            header: (
              <TaskTimelinePagination
                error={olderHistoryError}
                isLoading={isLoadingOlderHistory}
                onLoad={onLoadOlderHistory}
              />
            ),
          }
        : {})}
      items={turnIds}
      renderNavigation={(navigateToItem, scrollbarWidth, scrollContainerRef) => (
        <>
        {searchTarget === undefined ? null : <HistoryNavigation target={searchTarget} turnIds={turnIds} navigate={navigateToItem} containerRef={scrollContainerRef} />}
        <TaskTimelineNavigation
          items={navigationItems}
          scrollContainerRef={scrollContainerRef}
          scrollbarWidth={scrollbarWidth}
          onNavigate={(item) => {
            navigateToItem(item.turnIndex, item.anchorId);
          }}
        />
        </>
      )}
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
          pendingSubmission={!showPendingFooter && showPendingSubmission && turnId === submissionTurnId}
        />
      )}
      {...(scrollToBottomSignal === undefined ? {} : { scrollToBottomSignal })}
    />
  );
}
