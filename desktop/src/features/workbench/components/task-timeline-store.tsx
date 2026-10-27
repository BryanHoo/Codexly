import { TurnProcessHistory } from "./task-timeline-lazy-process.js";
import { TimelineImageProvider } from "./timeline-image-provider.js";
import { hasPromptTurnFinished } from "@codexly/frontend-core/prompt-delivery";
import { HistoryNavigation, type HistoryAnchor } from "../../search/history-navigation.js";
import type { PendingRequest } from "@/protocol/index.js";
import { memo, useMemo, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { groupTimelineTurns, mergeTimelineTurns } from "@codexly/frontend-core/timeline-turn-groups";
import { StoredAssistantGroup } from "./task-timeline-store-assistant.js";
import { i18n } from "../../../i18n/i18n.js";
import { ConversationList } from "../../../shared/components/agent/conversation.js";
import { Message, type MessageFileReference } from "../../../shared/components/agent/message.js";
import type {
  TaskStore,
} from "../../conversation/runtime/task-store.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { PendingRequestCard, type PendingRequestResolution } from "./pending-request.js";
import type { BuildPlanAction, ForkTaskAction } from "./task-timeline-contracts.js";
import { useTurnSizeEstimate } from "./task-timeline-estimate.js";
import { resolveCompletedTurnProcessItemIds } from "./task-timeline-process.js";
import { TaskTimelinePagination } from "./task-timeline-pagination.js";
import {
  TaskTimelineNavigation,
  getTaskTimelineNavigationItems,
} from "./task-timeline-navigation.js";
import { RunningReplyStatus } from "./task-timeline-running.js";
import { PendingPromptDisplay, type PendingPrompt } from "./pending-prompt.js";
import { getTimelineNotices, StoreTaskInfoNotices } from "./task-timeline-notices.js";
export { getTimelineNotices } from "./task-timeline-notices.js";
import {
  StoredUserMessage,
  groupStoredTurnTimelineItems,
} from "./task-timeline-store-items.js";
import { TimelineState, TurnProcessingTime } from "./task-timeline-status.js";
const getTurnIdKey = (turnId: string) => turnId;
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
  groupedTurnIds,
  pendingSubmission,
  pendingPrompt,
  hasNextSubmission = false,
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
  groupedTurnIds?: readonly string[] | undefined;
  pendingSubmission: boolean;
  pendingPrompt?: PendingPrompt;
  hasNextSubmission?: boolean;
}>) {
  const sourceIds = useMemo(() => groupedTurnIds ?? [turnId], [groupedTurnIds, turnId]);
  const sourceTurns = useStore(store, useShallow((state) => sourceIds.flatMap((id) => state.turnsById[id] ?? [])));
  // 只订阅每个阶段的键数组引用；Token 事件不得反复展开全部历史 Item 键。
  const sourceItemKeys = useStore(store, useShallow((state) =>
    sourceIds.map((id) => state.itemKeysByTurnId[id]),
  ));
  const itemKeys = useMemo(() => sourceItemKeys.flatMap((keys) => keys ?? []), [sourceItemKeys]);
  const turn = useMemo(() => mergeTimelineTurns(sourceTurns), [sourceTurns]);
  const [processExpanded, setProcessExpanded] = useState(false);
  if (turn === undefined) return null;
  const itemStoresByKey = store.getState().itemStoresByKey;
  const processTurns = sourceTurns.filter((source) => source.processCursor !== undefined && source.status !== "running");
  // 每个阶段独立分类执行记录，避免把较早阶段的最终答复误折叠进最后一段过程。
  const processItemKeys = new Set<string>();
  const paginatedProcessItemKeys = new Set<string>();
  sourceTurns.forEach((source, index) => {
    const keys = store.getState().itemKeysByTurnId[source.id] ?? [];
    const processIds = new Set(resolveCompletedTurnProcessItemIds(
      keys.flatMap((key) => itemStoresByKey.get(key)?.peek() ?? []),
      source.status,
      hasNextSubmission || index < sourceTurns.length - 1,
    ));
    for (const key of keys) {
      if (!processIds.has(itemStoresByKey.get(key)?.peek().id ?? "")) continue;
      processItemKeys.add(key);
      // 已分页的过程由独立历史 Store 展示，展开时不能再把内存中的同一记录显示一遍。
      if (source.processCursor !== undefined) paginatedProcessItemKeys.add(key);
    }
  });
  // 仅提前移除会切断答复分组的用户引导；助手过程项留作稳定的分组锚点，
  // 由 StoredAssistantGroup 控制显示，避免展开/收起重挂载历史并重复请求。
  const hiddenProcessItemKeys =
    turn.status !== "completed" || processExpanded ? undefined : new Set(
      [...processItemKeys].filter((key) => {
        const item = itemStoresByKey.get(key)?.peek();
        return item?.type === "message" && item.role === "user";
      }),
    );
  const timelineGroups = groupStoredTurnTimelineItems(
    itemKeys,
    itemStoresByKey,
    hiddenProcessItemKeys,
  );
  const processToggleAvailable = processItemKeys.size > 0 || processTurns.length > 0;
  const firstAssistantGroupIndex = timelineGroups.findIndex((group) => group.type === "assistant");
  const hasAssistantItems = firstAssistantGroupIndex >= 0;
  const lastTurnItemKey = itemKeys.at(-1);
  const hasUserMessage = timelineGroups.some((group) => group.type === "user");

  return (
    <section aria-label={`Turn ${turnIndex + 1}`} className="space-y-4" data-status={turn.status}>
      {pendingPrompt !== undefined && !hasUserMessage ? <PendingPromptDisplay prompt={pendingPrompt} /> : null}
      {timelineGroups.map((group, groupIndex) =>
        group.type === "user" ? (
          <StoredUserMessage
            itemKey={group.itemKey}
            // 首条输入从本地占位切换为权威 ID 时保留气泡节点，避免重新挂载 Markdown。
            key={groupIndex === 0 ? turnId : group.itemKey}
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
            processTurns={processTurns}
            processItemKeys={processItemKeys}
            paginatedProcessItemKeys={paginatedProcessItemKeys}
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
      {/* 引导或问答答案会让用户消息成为尾组；运行提示应接在该消息后，不能依赖历史助手组是否存在。 */}
      {turn.status === "running" && (itemKeys.length > 0 || pendingSubmission) &&
      timelineGroups.at(-1)?.type !== "assistant" ? (
        <Message from="assistant">
          {/* 已有助手组承载回合计时，尾部补位只显示运行提示，避免重复计时。 */}
          {!hasAssistantItems ? <TurnProcessingTime status={turn.status} completedAt={turn.completedAt} startedAt={turn.startedAt} /> : null}
          <RunningReplyStatus />
        </Message>
      ) : null}
      {!hasAssistantItems && turn.status !== "running" && processTurns.length > 0 ? (
        <Message from="assistant">
          <TurnProcessingTime status={turn.status} startedAt={turn.startedAt} completedAt={turn.completedAt}
            expanded={processExpanded} onToggle={() => { setProcessExpanded((value) => !value); }} />
          {processTurns.map((source) => <TurnProcessHistory key={source.id} expanded={processExpanded}
            initialCursor={source.processCursor ?? ""} projectId={projectId} taskId={taskId} turnId={source.id}
            onOpenFileDiff={onOpenFileDiff} onOpenSourceFile={onOpenSourceFile} />)}
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
    return request === undefined ||
      (request.status === "resolved" && request.type !== "plugin_install_suggestion")
      ? []
      : [request];
  });
  const firstPendingIndex = visiblePendingRequests.findIndex(({ status }) => status === "pending");

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
  pendingRequestsExternal = false,
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
  pendingPrompt,
}: Readonly<{
  pendingRequestsExternal?: boolean;
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
  pendingPrompt?: PendingPrompt;
}>) {
  const projectId = store.getState().projectId;
  const taskId = store.getState().taskId;
  const imageRootPath = useStore(store, (state) => state.snapshotMetadata?.workspacePath);
  const turnIds = useStore(store, (state) => state.turnIds);
  const itemStructureRevision = useStore(store, (state) => state.itemStructureRevision);
  const engine = useStore(store, (state) => state.snapshotMetadata?.engine);
  const turnGroups = useMemo(() => {
    void itemStructureRevision;
    void turnIds;
    return groupTimelineTurns(store.getState(), engine);
  }, [engine, itemStructureRevision, store, turnIds]);
  const displayTurnIds = useMemo(() => turnGroups.map((group) => group.id), [turnGroups]);
  const groupById = useMemo(() => new Map(turnGroups.map((group) => [group.id, group])), [turnGroups]);
  const displayIndexByTurnId = useMemo(() => new Map(turnGroups.flatMap((group, index) =>
    group.turnIds.map((id) => [id, index] as const))), [turnGroups]);
  const pendingRequestIds = useStore(store, (state) => state.pendingRequestIds);
  const pendingRequestsById = useStore(store, (state) => state.pendingRequestsById);
  const notices = useStore(store, (state) => state.notices);
  const hasVisiblePendingRequest = !pendingRequestsExternal && pendingRequestIds.some(
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
    // 权威终态立即释放占位；空回合或迟到的本地提交状态也不能重新开启计时。
    if (hasPromptTurnFinished(turn?.status)) return undefined;
    if (turn === undefined || (!state.itemKeysByTurnId[submissionTurnId]?.length && pendingPrompt === undefined)) {
      return "footer";
    }
    const groups = groupStoredTurnTimelineItems(
      state.itemKeysByTurnId[submissionTurnId] ?? [],
      state.itemStoresByKey,
    );
    return (groups.some((group) => group.type === "assistant") &&
      (pendingPrompt === undefined || groups.some((group) => group.type === "user")))
      ? undefined
      : "turn";
  });
  // 已知回合内同时布局输入、时间与运行态，避免独立虚拟尾部二次测量将输入顶走。
  const showPendingSubmission =
    submissionStartedAt !== undefined && submissionHandoffState !== undefined;
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
    <TimelineImageProvider projectId={projectId} taskId={taskId} rootPath={imageRootPath}>
    <ConversationList
      aria-label={i18n.t("timeline.conversation", { ns: "conversation" })}
      conversationId={`${projectId}:${taskId}`}
      estimateItemSize={(id) => (groupById.get(id)?.turnIds ?? [id]).reduce((total, sourceId) => total + estimateTurnSize(sourceId), 0)}
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
                  pendingPrompt === undefined ? <Message from="assistant">
                    <TurnProcessingTime status="running" completedAt={null} startedAt={submissionStartedAt} />
                    <RunningReplyStatus />
                  </Message> : <PendingPromptDisplay prompt={pendingPrompt} startedAt={submissionStartedAt} />
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
      items={displayTurnIds}
      renderNavigation={(navigateToItem, scrollbarWidth, scrollContainerRef) => (
        <>
          {searchTarget === undefined ? null : (
            <HistoryNavigation
              target={searchTarget}
              turnIds={turnIds}
              navigate={(index, anchorId) => navigateToItem(displayIndexByTurnId.get(turnIds[index] ?? "") ?? index, anchorId)}
              containerRef={scrollContainerRef}
            />
          )}
          <TaskTimelineNavigation
            items={navigationItems}
            scrollContainerRef={scrollContainerRef}
            scrollbarWidth={scrollbarWidth}
            onNavigate={(item) => {
              navigateToItem(displayIndexByTurnId.get(turnIds[item.turnIndex] ?? "") ?? item.turnIndex, item.anchorId);
            }}
          />
        </>
      )}
      renderItem={(turnId, turnIndex) => (
        <StoreTurnTimelineSection
          {...(connected && turnId === displayTurnIds.at(-1) && onBuildPlan !== undefined
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
          groupedTurnIds={groupById.get(turnId)?.turnIds}
          hasNextSubmission={turnIndex < displayTurnIds.length - 1 || (showPendingSubmission && !groupById.get(turnId)?.turnIds.includes(submissionTurnId ?? ""))}
          pendingSubmission={
            !showPendingFooter && showPendingSubmission && (groupById.get(turnId)?.turnIds.includes(submissionTurnId ?? "") ?? false)
          }
          {...(groupById.get(turnId)?.turnIds.includes(submissionTurnId ?? "") && showPendingSubmission && pendingPrompt !== undefined
            ? { pendingPrompt }
            : {})}
        />
      )}
      {...(scrollToBottomSignal === undefined ? {} : { scrollToBottomSignal })}
    />
    </TimelineImageProvider>
  );
}
