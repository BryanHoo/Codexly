import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentProviderTurnInput, LocalTask } from "@codexly/core";
import type { AgentTurnOptions, ClaudeSettings } from "@codexly/protocol";
import type { ClaudeConfiguration } from "./config.js";
import type { ClaudePermissions } from "./permissions.js";
import type { ClaudeSessionGrants } from "./session-grants.js";
import { wakeupHooks, type ClaudeSdk, type Running, type createInput } from "./session.js";

/** 新查询集中重放会话配置；普通消息与压缩命令使用完全相同的权限和恢复语义。 */
export function createClaudeQuery({
  sdk,
  config,
  task,
  options,
  defaults,
  permissionMode,
  controller,
  permissions,
  grants,
  sessionId,
  resumable,
  inputStream,
  outputSchema,
  getRunning,
}: {
  sdk: ClaudeSdk;
  config: ClaudeConfiguration;
  task: LocalTask;
  options: AgentTurnOptions;
  defaults: ClaudeSettings;
  permissionMode: ClaudeSettings["permissionMode"];
  controller: AbortController;
  permissions: ClaudePermissions;
  grants: ClaudeSessionGrants;
  sessionId: string;
  resumable: boolean;
  inputStream: ReturnType<typeof createInput>;
  outputSchema: AgentProviderTurnInput["outputSchema"];
  getRunning: () => Running | undefined;
}): Query {
  return sdk.query({
    prompt: inputStream,
    options: {
      cwd: task.cwd,
      // 两端都提供计划面板，显式启用任务工具；不改写用户配置或自动放行工具权限。
      env: { ...config.environment(), CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" },
      // default 保留 SDK 对本机及项目模型配置的解析，不传 CLI 的 --model 覆盖。
      ...(options.model && options.model !== "default" ? { model: options.model } : {}),
      // 原样传递 auto 与会话显式选择；可用性限制交给 SDK，不在应用内静默降级。
      permissionMode,
      allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
      hooks: wakeupHooks(getRunning),
      includePartialMessages: true,
      persistSession: true,
      // 公共输入沿用 Codex 的字段名，在共享 SDK 边界转换为 Claude 原生结构化输出配置。
      ...(outputSchema === undefined
        ? {}
        : { outputFormat: { type: "json_schema", schema: outputSchema } as const }),
      // 两端均已接入单任务 stopTask；声明后前台中断才会保留后台代理与工作流。
      perTaskStopAffordance: true,
      abortController: controller,
      // SDK 先执行原生 Elicitation Hook，仅未处理的请求进入两端共用交互。
      // 回调没有工具/代理身份，绑定调用时的当前回合，不能捕获首次启动的旧回合。
      onElicitation: (request, elicitationOptions) => {
        const active = getRunning();
        return (active?.permissions.get(active.projection.id) ?? permissions).elicitation.request(
          request,
          elicitationOptions,
        );
      },
      canUseTool: (name, input, toolOptions) => {
        const active = getRunning();
        const owner = [...(active?.projections.values() ?? [])].find((candidate) =>
          candidate.ownsMessage({
            tool_use_id: toolOptions.toolUseID,
            agent_id: toolOptions.agentID,
          }),
        );
        return (active?.permissions.get(owner?.id ?? active.projection.id) ?? permissions).request(
          name,
          input,
          toolOptions,
        );
      },
      settingSources: defaults.loadProjectSettings ? ["user", "project", "local"] : ["user"],
      // 原生 allow/deny 由 settingSources 保留路径基准；SDK 参数仅重放当前聊天授权。
      ...grants.options(permissionMode),
      ...(["low", "medium", "high", "xhigh", "max"].includes(options.reasoningEffort)
        ? { effort: options.reasoningEffort as "low" | "medium" | "high" | "xhigh" | "max" }
        : {}),
      // 全局指令由 SDK 从用户 CLAUDE.md 加载，避免再 append 一次造成重复。
      systemPrompt: { type: "preset", preset: "claude_code" },
      ...(resumable ? { resume: sessionId } : { sessionId }),
    },
  });
}
