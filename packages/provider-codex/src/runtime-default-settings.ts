import type { AgentRuntimeDefaultSettings } from "@codexly/core";
import type { CodexRpcClient } from "./agent-provider-base.js";

const fields = {
  approvalPolicy: "approval_policy",
  approvalsReviewer: "approvals_reviewer",
  model: "model",
  reasoningEffort: "model_reasoning_effort",
  sandboxMode: "sandbox_mode",
  fastMode: "service_tier",
} as const;

export async function writeRuntimeDefaultSettings(
  client: CodexRpcClient,
  settings: AgentRuntimeDefaultSettings,
): Promise<void> {
  const edits = (Object.keys(fields) as (keyof typeof fields)[])
    .filter((key) => settings[key] !== undefined)
    .map((key) => ({
      keyPath: fields[key],
      // default 显式关闭快速档位；不删除键，避免重新继承模型的默认档位。
      value: key === "fastMode" ? (settings.fastMode ? "priority" : "default") : settings[key],
      mergeStrategy: "replace",
    }));
  if (edits.length === 0) return;
  // 不传 cwd 或 filePath，由 Codex 定位用户全局配置并完成校验、原子写入与重载。
  await client.request("config/batchWrite", { edits, reloadUserConfig: true });
}

export function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function optionalApprovalPolicy(
  value: unknown,
): AgentRuntimeDefaultSettings["approvalPolicy"] {
  if (value === "on-request" || value === "never") {
    return value;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !("granular" in record)) {
    return undefined;
  }
  const granular = record["granular"];
  if (typeof granular !== "object" || granular === null || Array.isArray(granular)) {
    return undefined;
  }
  const fields = granular as Record<string, unknown>;
  const knownFields = new Set([
    "mcp_elicitations",
    "request_permissions",
    "rules",
    "sandbox_approval",
    "skill_approval",
  ]);
  if (
    Object.keys(fields).some((key) => !knownFields.has(key)) ||
    typeof fields["mcp_elicitations"] !== "boolean" ||
    typeof fields["rules"] !== "boolean" ||
    typeof fields["sandbox_approval"] !== "boolean" ||
    (fields["request_permissions"] !== undefined &&
      typeof fields["request_permissions"] !== "boolean") ||
    (fields["skill_approval"] !== undefined && typeof fields["skill_approval"] !== "boolean")
  ) {
    return undefined;
  }
  return {
    granular: {
      mcp_elicitations: fields["mcp_elicitations"],
      request_permissions: fields["request_permissions"] ?? false,
      rules: fields["rules"],
      sandbox_approval: fields["sandbox_approval"],
      skill_approval: fields["skill_approval"] ?? false,
    },
  };
}

export function optionalSandboxMode(value: unknown): AgentRuntimeDefaultSettings["sandboxMode"] {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access"
    ? value
    : undefined;
}
