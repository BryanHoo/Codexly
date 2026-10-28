import { OperationGroup } from "@codexly/ui/agent/operation-group";
import type { AgentItem } from "@codexly/protocol";
import { hasReasoningSummary } from "@codexly/frontend-core/reasoning-summary";
import { isInlineFileChangeVisible } from "@codexly/frontend-core/turn-process";
import { isTimelineOperation } from "@codexly/frontend-core/timeline-operation";
import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { i18n } from "../../../i18n/i18n.js";
import type { TaskItemStore, TaskStore } from "../../conversation/runtime/task-store.js";

export type TimelineOperationGroup =
  | Readonly<{ itemKey: string; type: "item" }>
  | Readonly<{ itemKeys: readonly string[]; key: string; type: "operation_group" }>;

export function filterRenderableTimelineItemKeys(
  itemKeys: readonly string[],
  itemStoresByKey: ReadonlyMap<string, TaskItemStore>,
  turnStatus = "running",
): string[] {
  return itemKeys.filter((itemKey) => {
    const itemStore = itemStoresByKey.get(itemKey);
    const baseItem = itemStore?.peek();
    if (baseItem?.type === "file_change")
      return isInlineFileChangeVisible(baseItem.status, turnStatus);
    if (itemStore?.peek().type !== "reasoning") {
      return true;
    }
    return hasReasoningSummary(itemStore.readReasoningSummary());
  });
}

export function groupConsecutiveTimelineOperations(
  itemKeys: readonly string[],
  getItem: (itemKey: string) => AgentItem | undefined,
): TimelineOperationGroup[] {
  const groups: TimelineOperationGroup[] = [];
  let operationKeys: string[] = [];

  const flushOperations = () => {
    const firstKey = operationKeys[0];
    if (firstKey === undefined) {
      return;
    }

    // 从首条操作起保持稳定的组身份，后续追加不会把原有行重新挂载到另一棵树。
    groups.push(
      operationKeys.length === 1 && getItem(firstKey)?.type === "reasoning"
        ? { itemKey: firstKey, type: "item" }
        : { itemKeys: operationKeys, key: firstKey, type: "operation_group" },
    );
    operationKeys = [];
  };

  for (const itemKey of itemKeys) {
    if (isTimelineOperation(getItem(itemKey))) {
      operationKeys.push(itemKey);
      continue;
    }

    flushOperations();
    groups.push({ itemKey, type: "item" });
  }
  flushOperations();

  return groups;
}

export type TimelineOperationSummary = Readonly<{
  commandCount: number;
  failedCount: number;
  fileCount: number;
  isActive: boolean;
  reasoningCount: number;
  toolCount: number;
}>;

export function summarizeTimelineOperations(items: readonly AgentItem[]): TimelineOperationSummary {
  let commandCount = 0;
  let failedCount = 0;
  let isActive = false;
  let reasoningCount = 0;
  let toolCount = 0;
  const filePaths = new Set<string>();

  for (const item of items) {
    if (!isTimelineOperation(item)) {
      continue;
    }
    if (item.type === "reasoning") {
      reasoningCount += 1;
      continue;
    }
    if (item.type === "command") {
      commandCount += 1;
    } else if (item.type === "tool" || item.type === "activity") {
      // 查看图片沿用工具计数，运行中保持展开，失败时进入同一组的失败摘要。
      toolCount += 1;
    } else {
      // 同一组多次修改同一文件时，摘要仅计数一次。
      for (const change of item.changes) filePaths.add(change.path);
    }
    if (item.status === "pending" || item.status === "running") {
      isActive = true;
    } else if (
      item.status === "failed" ||
      item.status === "declined" ||
      item.status === "interrupted"
    ) {
      failedCount += 1;
    }
  }

  return {
    commandCount,
    failedCount,
    fileCount: filePaths.size,
    isActive,
    reasoningCount,
    toolCount,
  };
}

function formatTimelineOperationSummary(summary: TimelineOperationSummary): string {
  let baseSummary =
    summary.toolCount > 0 && summary.commandCount > 0
      ? i18n.t("timeline.operationGroup.summary", {
          commandCount: summary.commandCount,
          ns: "conversation",
          toolCount: summary.toolCount,
        })
      : summary.toolCount > 0
        ? i18n.t("timeline.operationGroup.toolsOnly", {
            count: summary.toolCount,
            ns: "conversation",
          })
        : summary.commandCount > 0
          ? i18n.t("timeline.operationGroup.commandsOnly", {
              count: summary.commandCount,
              ns: "conversation",
            })
          : summary.fileCount > 0
            ? i18n.t("timeline.operationGroup.filesOnly", {
                count: summary.fileCount,
                ns: "conversation",
              })
            : i18n.t("timeline.operationGroup.reasoningOnly", {
                count: summary.reasoningCount,
                ns: "conversation",
              });

  if (
    summary.reasoningCount > 0 &&
    summary.commandCount + summary.toolCount + summary.fileCount > 0
  ) {
    baseSummary += i18n.t("timeline.operationGroup.reasoningSuffix", {
      count: summary.reasoningCount,
      ns: "conversation",
    });
  }

  if (summary.fileCount > 0 && summary.commandCount + summary.toolCount > 0) {
    baseSummary += i18n.t("timeline.operationGroup.filesSuffix", {
      count: summary.fileCount,
      ns: "conversation",
    });
  }

  return summary.failedCount === 0
    ? baseSummary
    : `${baseSummary}${i18n.t("timeline.operationGroup.failed", {
        count: summary.failedCount,
        ns: "conversation",
      })}`;
}

export function TimelineOperationGroupDisclosure({
  collapseAfterItemKey,
  children,
  itemKeys,
  store,
}: Readonly<{
  collapseAfterItemKey?: string;
  children: ReactNode;
  itemKeys: readonly string[];
  store: TaskStore;
}>) {
  const itemStores = useMemo(() => {
    const storesByKey = store.getState().itemStoresByKey;
    return itemKeys.flatMap((itemKey) => storesByKey.get(itemKey) ?? []);
  }, [itemKeys, store]);
  const collapseTriggerStore = useMemo(
    () =>
      collapseAfterItemKey === undefined
        ? undefined
        : store.getState().itemStoresByKey.get(collapseAfterItemKey),
    [collapseAfterItemKey, store],
  );
  const subscribedStores = useMemo(
    () => (collapseTriggerStore === undefined ? itemStores : [...itemStores, collapseTriggerStore]),
    [collapseTriggerStore, itemStores],
  );
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const unsubscribes = subscribedStores.map((itemStore) => itemStore.subscribe(onStoreChange));
      return () => {
        for (const unsubscribe of unsubscribes) {
          unsubscribe();
        }
      };
    },
    [subscribedStores],
  );
  const getRevisionSnapshot = useCallback(
    () => subscribedStores.map((itemStore) => itemStore.getState().revision).join(","),
    [subscribedStores],
  );

  // 聚合组件只订阅组内 revision，命令输出 Delta 不会让外层 Timeline 重渲染。
  useSyncExternalStore(subscribe, getRevisionSnapshot, getRevisionSnapshot);
  const summary = summarizeTimelineOperations(itemStores.map((itemStore) => itemStore.peek()));
  const collapseTrigger = collapseTriggerStore?.peek();
  const hasFollowingAssistantText =
    collapseTrigger?.type === "message" &&
    collapseTrigger.role === "assistant" &&
    collapseTrigger.text.trim().length > 0;

  const summaryText = formatTimelineOperationSummary(summary);
  return (
    <OperationGroup
      active={summary.isActive}
      autoOpen={!hasFollowingAssistantText || summary.isActive}
      collapseLabel={i18n.t("timeline.operationGroup.collapse", {
        ns: "conversation",
        summary: summaryText,
      })}
      expandLabel={i18n.t("timeline.operationGroup.expand", {
        ns: "conversation",
        summary: summaryText,
      })}
      runningLabel={i18n.t("agentComponents.status.running", { ns: "conversation" })}
      closeLabel={i18n.t("actions.close", { ns: "workbench" })}
      summary={summaryText}
      count={itemKeys.length}
    >
      {children}
    </OperationGroup>
  );
}
