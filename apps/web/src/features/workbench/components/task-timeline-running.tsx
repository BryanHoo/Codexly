import { RunningReplyStatus as SharedRunningReplyStatus } from "@codexly/ui/agent/running-reply-status";
import type { AgentItem, AgentTurn } from "@codexly/protocol";

import { i18n } from "../../../i18n/i18n.js";

import {
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
  type TaskStatus,
} from "../../../shared/components/agent/task.js";
import { PENDING_COMMAND_LABEL } from "../../conversation/runtime/task-store.js";

export function getCommandLabel(command: string): string {
  return command === PENDING_COMMAND_LABEL
    ? i18n.t("timeline.commandPending", { ns: "conversation" })
    : command;
}

export function RunningReplyStatus() {
  return (
    <SharedRunningReplyStatus
      accessibleLabel={i18n.t("timeline.aiRunning", { ns: "conversation" })}
      text={i18n.t("timeline.running", { ns: "conversation" })}
    />
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
