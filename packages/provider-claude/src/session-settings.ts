import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentProviderTurnInput } from "@codexly/core";
import type { AgentTurnOptions, ClaudeSettings } from "@codexly/protocol";
import type { ClaudeSessionGrants } from "./session-grants.js";

export interface ClaudeSessionSettings {
  model: string | undefined;
  effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
  permissionMode: ClaudeSettings["permissionMode"];
  defaults: Pick<ClaudeSettings, "model" | "reasoningEffort">;
}

/** 动态参数独立比较，其余启动配置变化仍须用原会话身份重建查询。 */
export function claudeQuerySettingsKey(
  options: AgentTurnOptions,
  defaults: ClaudeSettings,
  connectionRevision: string,
  outputSchema: AgentProviderTurnInput["outputSchema"],
): string {
  return JSON.stringify({
    options: { ...options, model: undefined, reasoningEffort: undefined, engineOptions: undefined },
    defaults: {
      ...defaults,
      model: undefined,
      reasoningEffort: undefined,
      permissionMode: undefined,
    },
    connectionRevision,
    outputSchema,
  });
}

/** 只比较 SDK 实际使用的参数，避免 default 与空模型等价时重复发送控制请求。 */
export function claudeSessionSettings(
  options: AgentTurnOptions,
  permissionMode: ClaudeSettings["permissionMode"],
  defaults: ClaudeSettings,
): ClaudeSessionSettings {
  const effort = options.reasoningEffort;
  return {
    model: options.model && options.model !== "default" ? options.model : undefined,
    effort:
      effort === "low" ||
      effort === "medium" ||
      effort === "high" ||
      effort === "xhigh" ||
      effort === "max"
        ? effort
        : null,
    permissionMode,
    defaults: { model: defaults.model, reasoningEffort: defaults.reasoningEffort },
  };
}

/** 控制接口逐项确认；失败保留已成功的状态，重试不能假定整组变更已回滚。 */
export async function updateClaudeSessionSettings(
  query: Query,
  applied: ClaudeSessionSettings,
  next: ClaudeSessionSettings,
  grants: ClaudeSessionGrants,
): Promise<void> {
  if (applied.permissionMode !== next.permissionMode) {
    await query.setPermissionMode(next.permissionMode);
    applied.permissionMode = next.permissionMode;
    // 只有 SDK 接受显式模式后才清除旧 acceptEdits 许可，避免恢复时重放失效授权。
    grants.options(next.permissionMode);
  }
  if (
    applied.model !== next.model ||
    (next.model === undefined && applied.defaults.model !== next.defaults.model)
  ) {
    const model = next.model ?? next.defaults.model;
    await query.setModel(model && model !== "default" ? model : undefined);
    applied.model = next.model;
  }
  applied.defaults.model = next.defaults.model;
  if (
    applied.effort !== next.effort ||
    (next.effort === null && applied.defaults.reasoningEffort !== next.defaults.reasoningEffort)
  ) {
    // 清除显式覆盖时恢复原生用户强度；未配置则用 null 恢复模型默认，避免旧会话覆盖残留。
    await query.applyFlagSettings({
      effortLevel: next.effort ?? (next.defaults.reasoningEffort || null),
    });
    applied.effort = next.effort;
  }
  applied.defaults.reasoningEffort = next.defaults.reasoningEffort;
}
