import { TraceStatusIcon } from "@codexly/ui/core/trace-status";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
  TraceLine,
  TraceIcon,
} from "@codexly/ui/core/trace";
import type { AgentItem } from "@codexly/protocol";
import { hasReasoningSummary } from "@codexly/frontend-core/reasoning-summary";
import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { i18n } from "../../../i18n/i18n.js";
import type { TaskItemStore, TaskStore } from "../../conversation/runtime/task-store.js";

type TimelineOperationItem = Extract<
  AgentItem,
  { type: "command" | "tool" | "file_change" | "reasoning" }
>;

export type TimelineOperationGroup =
  | Readonly<{ itemKey: string; type: "item" }>
  | Readonly<{ itemKeys: readonly string[]; key: string; type: "operation_group" }>;

function isTimelineOperation(item: AgentItem | undefined): item is TimelineOperationItem {
  return (
    item?.type === "command" ||
    item?.type === "tool" ||
    item?.type === "file_change" ||
    item?.type === "reasoning"
  );
}

export function filterRenderableTimelineItemKeys(
  itemKeys: readonly string[],
  itemStoresByKey: ReadonlyMap<string, TaskItemStore>,
): string[] {
  return itemKeys.filter((itemKey) => {
    const itemStore = itemStoresByKey.get(itemKey);
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

    // 文件修改没有 Tool 自带的折叠容器，单项也需在后续回复出现后收起。
    groups.push(
      operationKeys.length === 1 && getItem(firstKey)?.type !== "file_change"
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
    } else if (item.type === "tool") {
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
  const [expanded, setExpanded] = useState(false);
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

  // 始终复用同一个折叠节点，后续文字到达时由 Radix 完整播放收起过渡。
  const inline = !hasFollowingAssistantText || summary.isActive;
  const summaryText = formatTimelineOperationSummary(summary);
  return (
    <Trace>
      <TraceCollapsible
        className="group/operation w-full"
        data-operation-group={inline ? undefined : ""}
        data-operation-group-active={summary.isActive ? "" : undefined}
        onOpenChange={setExpanded}
        open={inline || expanded}
      >
        <TraceCollapsibleTrigger
          style={inline ? { display: "none" } : undefined}
          aria-expanded={inline || expanded}
          aria-label={i18n.t(
            expanded ? "timeline.operationGroup.collapse" : "timeline.operationGroup.expand",
            { ns: "conversation", summary: summaryText },
          )}
          className="max-w-full"
        >
          {!inline && (
            <TraceLine status={summary.failedCount > 0 ? "error" : undefined}>
              <TraceIcon>
                <TraceStatusIcon status={summary.failedCount > 0 ? "error" : "completed"} />
              </TraceIcon>
              <span className="min-w-0 flex-1 font-medium">{summaryText}</span>
            </TraceLine>
          )}
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="agent-operation-list" data-inline={inline}>
          {children}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
