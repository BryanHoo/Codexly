import type { AgentItem, AgentItemStatus } from "@code-agent/protocol";

import { CodexProtocolMappingError } from "./codex-mapping-common.js";

export type AgentApprovalReviewItem = Extract<AgentItem, { type: "approval_review" }>;

export function mapItemStatus(value: unknown): AgentItemStatus {
  if (value === "inProgress") {
    return "running";
  }
  if (value === "completed" || value === "failed" || value === "declined") {
    return value;
  }
  if (value === "interrupted" || value === "pending" || value === "running") {
    return value;
  }
  return "completed";
}

// App Server 暂未把自动审批建模为普通 Item，这里将两段通知投影为同一流式 Item。
export function mapApprovalReviewStatus(value: unknown): AgentApprovalReviewItem["status"] {
  if (value === "inProgress") return "in_progress";
  if (value === "approved" || value === "denied" || value === "aborted") return value;
  if (value === "timedOut") return "timed_out";
  throw new CodexProtocolMappingError("Codex automatic approval review status is invalid");
}
