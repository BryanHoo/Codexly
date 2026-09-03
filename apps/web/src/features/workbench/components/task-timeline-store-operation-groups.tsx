import { Fragment, useCallback, useMemo, useSyncExternalStore } from "react";

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
        .map((itemStore) =>
          (itemStore.readReasoningSummary()?.trim().length ?? 0) > 0 ? "1" : "0",
        )
        .join(","),
    [reasoningItemStores],
  );

  // 只在摘要可见性变化时重渲染容器，空 reasoning 不创建 Item 组件。
  useSyncExternalStore(
    subscribeReasoningVisibility,
    getReasoningVisibilitySnapshot,
    getReasoningVisibilitySnapshot,
  );
  const renderableItemKeys = filterRenderableTimelineItemKeys(itemKeys, itemStoresByKey);
  const visibleGroups = groupConsecutiveTimelineOperations(renderableItemKeys, (itemKey) =>
    itemStoresByKey.get(itemKey)?.peek(),
  );

  return visibleGroups.map((group) => {
    const groupItemKeys = group.type === "item" ? [group.itemKey] : group.itemKeys;
    const content = groupItemKeys.map((itemKey) => (
      <StoredTimelineItemContent
        isLastTurnItem={itemKey === lastTurnItemKey}
        itemKey={itemKey}
        key={itemKey}
        {...(onBuildPlan === undefined ? {} : { onBuildPlan })}
        onOpenFileDiff={onOpenFileDiff}
        onOpenSourceFile={onOpenSourceFile}
        projectId={projectId}
        store={store}
        taskId={taskId}
        turnStatus={turnStatus}
      />
    ));
    if (group.type === "item") {
      return content[0] ?? null;
    }

    // 完成态只使用 Turn 级执行过程；展开时恢复原始操作行。
    if (turnStatus !== "running") {
      return <Fragment key={group.key}>{content}</Fragment>;
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
