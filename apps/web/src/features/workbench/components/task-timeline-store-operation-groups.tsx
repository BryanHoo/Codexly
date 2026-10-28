import { AgentEntry } from "@codexly/ui/agent/motion";
import { Trace } from "@codexly/ui/core/trace";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { hasReasoningSummary } from "@codexly/frontend-core/reasoning-summary";

import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import type { NormalizedAgentTurn, TaskStore } from "../../conversation/runtime/task-store.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { BuildPlanAction } from "./task-timeline-contracts.js";
import {
  filterRenderableTimelineItemKeys,
  groupConsecutiveTimelineOperations,
  TimelineOperationGroupDisclosure,
} from "./task-timeline-operation-groups.js";
import { StoredTimelineItemContent } from "./task-timeline-store-items.js";

export function StoredAssistantTimelineItems({
  itemKeys,
  itemTimings,
  lastTurnItemKey,
  onBuildPlan,
  onOpenFileDiff,
  onOpenSourceFile,
  projectId,
  store,
  taskId,
  turnStatus,
}: Readonly<{
  itemKeys: readonly string[];
  itemTimings?: NormalizedAgentTurn["itemTimings"];
  lastTurnItemKey: string | undefined;
  onBuildPlan?: BuildPlanAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  projectId: string;
  store: TaskStore;
  taskId: string;
  turnStatus: NormalizedAgentTurn["status"];
}>) {
  const itemStoresByKey = store.getState().itemStoresByKey;
  const reasoningItemStores = useMemo(
    () =>
      turnStatus === "running"
        ? itemKeys.flatMap((itemKey) => {
            const itemStore = itemStoresByKey.get(itemKey);
            return itemStore?.peek().type === "reasoning" ? [itemStore] : [];
          })
        : [],
    [itemKeys, itemStoresByKey, turnStatus],
  );
  const subscribeReasoningVisibility = useCallback(
    (onStoreChange: () => void) => {
      const unsubscribes = reasoningItemStores.map((itemStore) =>
        itemStore.subscribe(onStoreChange),
      );
      return () => {
        for (const unsubscribe of unsubscribes) {
          unsubscribe();
        }
      };
    },
    [reasoningItemStores],
  );
  const getReasoningVisibilitySnapshot = useCallback(
    () =>
      reasoningItemStores
        .map((itemStore) => (hasReasoningSummary(itemStore.readReasoningSummary()) ? "1" : "0"))
        .join(","),
    [reasoningItemStores],
  );

  // 只在摘要可见性变化时重渲染容器，空 reasoning 不创建 Item 组件。
  useSyncExternalStore(
    subscribeReasoningVisibility,
    getReasoningVisibilitySnapshot,
    getReasoningVisibilitySnapshot,
  );
  const renderableItemKeys = filterRenderableTimelineItemKeys(
    itemKeys,
    itemStoresByKey,
    turnStatus,
  );
  const visibleGroups = groupConsecutiveTimelineOperations(renderableItemKeys, (itemKey) =>
    itemStoresByKey.get(itemKey)?.peek(),
  );

  return visibleGroups.map((group) => {
    const groupItemKeys = group.type === "item" ? [group.itemKey] : group.itemKeys;
    const content = groupItemKeys.map((itemKey) => {
      const item = itemStoresByKey.get(itemKey)?.peek();
      const itemTiming =
        item?.type === "command" || item?.type === "tool" || item?.type === "file_change"
          ? itemTimings?.[item.id]
          : undefined;
      return (
        <AgentEntry
          key={itemKey}
          animationKey={itemKey}
          live={turnStatus === "running"}
          kind={item?.type === "message" ? "message" : "trace"}
        >
          <StoredTimelineItemContent
            isLastTurnItem={itemKey === lastTurnItemKey}
            itemKey={itemKey}
            {...(itemTiming === undefined ? {} : { itemTiming })}
            key={itemKey}
            {...(onBuildPlan === undefined ? {} : { onBuildPlan })}
            onOpenFileDiff={onOpenFileDiff}
            onOpenSourceFile={onOpenSourceFile}
            projectId={projectId}
            store={store}
            taskId={taskId}
            turnStatus={turnStatus}
          />
        </AgentEntry>
      );
    });
    if (group.type === "item") {
      return content[0] ?? null;
    }

    // 完成态只使用 Turn 级执行过程；展开时恢复原始操作行。
    if (turnStatus !== "running") {
      return (
        <Trace className="agent-operation-list" key={group.key}>
          {content}
        </Trace>
      );
    }

    const groupEndIndex = renderableItemKeys.indexOf(group.itemKeys.at(-1) ?? group.key);
    const collapseAfterItemKey = renderableItemKeys.slice(groupEndIndex + 1).find((itemKey) => {
      const item = itemStoresByKey.get(itemKey)?.peek();
      return item?.type === "message" && item.role === "assistant";
    });
    return (
      <TimelineOperationGroupDisclosure
        {...(collapseAfterItemKey === undefined ? {} : { collapseAfterItemKey })}
        itemKeys={group.itemKeys}
        key={group.key}
        store={store}
      >
        {content}
      </TimelineOperationGroupDisclosure>
    );
  });
}
