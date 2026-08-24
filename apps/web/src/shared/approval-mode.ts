import type { AgentApprovalsReviewer, AgentTurnApprovalPolicy } from "@codexly/protocol";

type ApprovalSettings = Readonly<{
  approvalPolicy: AgentTurnApprovalPolicy;
  approvalsReviewer: AgentApprovalsReviewer;
}>;

export type ApprovalMode = "auto-review" | "never" | "on-request";

export function deriveApprovalMode(settings: ApprovalSettings): ApprovalMode {
  // `untrusted` 与细粒度策略是内部能力，界面统一投影为 CLI 可配置的按需审批。
  if (settings.approvalPolicy === "never") {
    return "never";
  }
  return settings.approvalPolicy === "on-request" && settings.approvalsReviewer === "auto_review"
    ? "auto-review"
    : "on-request";
}

export function applyApprovalMode<T extends ApprovalSettings>(settings: T, mode: ApprovalMode): T {
  return mode === "auto-review"
    ? { ...settings, approvalPolicy: "on-request", approvalsReviewer: "auto_review" }
    : { ...settings, approvalPolicy: mode, approvalsReviewer: "user" };
}
