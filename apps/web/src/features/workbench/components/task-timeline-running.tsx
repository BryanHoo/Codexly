import type { AgentItem, AgentTurn } from "@code-agent/protocol";
import { SquareTerminal } from "lucide-react";

import { i18n } from "../../../i18n/i18n.js";

import { Shimmer } from "../../../shared/components/agent/shimmer.js";
import {
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
  type TaskStatus,
} from "../../../shared/components/agent/task.js";
import { PENDING_COMMAND_LABEL } from "../../conversation/runtime/task-store.js";

export type IndexedAgentItem = Readonly<{
  item: AgentItem;
  itemIndex: number;
}>;

export type RunningOperation = Readonly<{
  label: string;
  type: "command" | "operation";
}>;

export function getCommandLabel(command: string): string {
  return command === PENDING_COMMAND_LABEL
    ? i18n.t("timeline.commandPending", { ns: "conversation" })
    : command;
}

export function resolveRunningOperation(
  items: readonly IndexedAgentItem[],
): RunningOperation | undefined {
  // 优先展示仍在运行的操作，避免并发 Item 的完成事件覆盖真实当前状态。
  const runningItem = items.findLast(({ item }) => {
    if (item.type === "command" || item.type === "tool") {
      return item.status === "pending" || item.status === "running";
    }
    if (item.type === "activity") {
      return item.status === "pending" || item.status === "running";
    }
    if (item.type === "approval_review") {
      return item.status === "in_progress";
    }
    return false;
  })?.item;

  if (runningItem?.type === "command") {
    return { label: getCommandLabel(runningItem.command), type: "command" };
  }
  if (runningItem?.type === "tool") {
    return { label: runningItem.name, type: "operation" };
  }
  if (runningItem?.type === "activity") {
    return { label: runningItem.label, type: "operation" };
  }
  if (runningItem?.type === "approval_review") {
    return {
      label: i18n.t("timeline.approvalReview.reviewing", { ns: "conversation" }),
      type: "operation",
    };
  }

  const latestItem = items.at(-1)?.item;
  if (latestItem?.type === "plan") {
    return {
      label: i18n.t("timeline.planGenerating", { ns: "conversation" }),
      type: "operation",
    };
  }

  // 快速操作可能在一次浏览器绘制前完成，但后续 Assistant 文本表示执行阶段已经推进。
  // 只回退到该消息之后完成的操作，避免把上下文压缩等历史状态重复显示为当前活动。
  const latestAssistantMessageIndex =
    items.findLast(({ item }) => item.type === "message" && item.role === "assistant")?.itemIndex ??
    -1;
  const recentItem = items.findLast(
    ({ item, itemIndex }) =>
      itemIndex > latestAssistantMessageIndex &&
      (item.type === "command" ||
        item.type === "tool" ||
        (item.type === "activity" && item.transient !== true)),
  )?.item;
  if (recentItem?.type === "command") {
    return { label: getCommandLabel(recentItem.command), type: "command" };
  }
  if (recentItem?.type === "tool") {
    return { label: recentItem.name, type: "operation" };
  }
  if (recentItem?.type === "activity") {
    return { label: recentItem.label, type: "operation" };
  }
  return undefined;
}

export function RunningReplyStatus({
  operation,
}: Readonly<{ operation?: RunningOperation | undefined }>) {
  const statusText =
    operation === undefined
      ? i18n.t("timeline.running", { ns: "conversation" })
      : i18n.t("timeline.runningOperation", {
          ns: "conversation",
          operation: operation.label,
        });
  const accessibleLabel =
    operation === undefined
      ? i18n.t("timeline.aiRunning", { ns: "conversation" })
      : i18n.t("timeline.aiRunningOperation", {
          ns: "conversation",
          operation: operation.label,
        });

  return (
    <div className="flex min-w-0 items-center gap-2 text-muted-foreground" role="status">
      {operation?.type === "command" ? (
        <SquareTerminal aria-hidden="true" className="size-3.5 shrink-0" />
      ) : null}
      <Shimmer aria-label={accessibleLabel} as="span" className="min-w-0 truncate text-body-small">
        {statusText}
      </Shimmer>
    </div>
  );
}

export function getReviewMessageText(item: Extract<AgentItem, { type: "review" }>): string {
  const target = item.target;
  if (target.type === "uncommitted_changes") {
    return i18n.t("timeline.reviewPrompt.uncommitted", { ns: "conversation" });
  }
  if (target.type === "base_branch") {
    return i18n.t("timeline.reviewPrompt.baseBranch", {
      branch: target.branch,
      ns: "conversation",
    });
  }
  if (target.type === "commit") {
    return target.title === undefined
      ? i18n.t("timeline.reviewPrompt.commit", { ns: "conversation", sha: target.sha })
      : i18n.t("timeline.reviewPrompt.commitWithTitle", {
          ns: "conversation",
          sha: target.sha,
          title: target.title,
        });
  }
  return i18n.t("timeline.reviewPrompt.custom", {
    instructions: target.instructions,
    ns: "conversation",
  });
}

export function ApprovalReviewItem({
  item,
}: Readonly<{ item: Extract<AgentItem, { type: "approval_review" }> }>) {
  const status = i18n.t(`timeline.approvalReview.status.${item.status}`, {
    ns: "conversation",
  });
  const taskStatus: TaskStatus =
    item.status === "in_progress"
      ? "in_progress"
      : item.status === "approved"
        ? "completed"
        : "error";

  return (
    <Task collapsible defaultOpen={item.status !== "approved"} status={taskStatus}>
      <TaskTrigger
        title={i18n.t("timeline.approvalReview.title", { ns: "conversation", status })}
      />
      <TaskContent>
        <TaskItem>
          {i18n.t("timeline.approvalReview.actionDetail", {
            action: i18n.t(`timeline.approvalReview.action.${item.action.type}`, {
              ns: "conversation",
            }),
            detail: item.action.detail,
            ns: "conversation",
          })}
        </TaskItem>
        {item.riskLevel === undefined ? null : (
          <TaskItem>
            {i18n.t("timeline.approvalReview.risk", {
              level: i18n.t(`timeline.approvalReview.riskLevel.${item.riskLevel}`, {
                ns: "conversation",
              }),
              ns: "conversation",
            })}
          </TaskItem>
        )}
        {item.userAuthorization === undefined ? null : (
          <TaskItem>
            {i18n.t("timeline.approvalReview.authorization", {
              level: i18n.t(
                `timeline.approvalReview.authorizationLevel.${item.userAuthorization}`,
                { ns: "conversation" },
              ),
              ns: "conversation",
            })}
          </TaskItem>
        )}
        {item.rationale === undefined ? null : (
          <TaskItem>
            {i18n.t("timeline.approvalReview.rationale", {
              ns: "conversation",
              rationale: item.rationale,
            })}
          </TaskItem>
        )}
      </TaskContent>
    </Task>
  );
}

export function resolveMessageResponseRendering({
  isLastTurnItem,
  role,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  role: Extract<AgentItem, { type: "message" }>["role"];
  turnStatus: AgentTurn["status"];
}>): Readonly<{ isAnimating: boolean; mode: "static" | "streaming" }> {
  const isActiveAssistantTail = role === "assistant" && isLastTurnItem && turnStatus === "running";
  return {
    isAnimating: isActiveAssistantTail,
    mode: isActiveAssistantTail ? "streaming" : "static",
  };
}
