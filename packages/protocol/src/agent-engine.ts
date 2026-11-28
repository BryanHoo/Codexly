import { Type, type Static } from "@sinclair/typebox";

/** 执行引擎与 API 服务商是两个概念；会话创建后引擎身份不可修改。 */
export const AgentEngineSchema = Type.Union([
  Type.Literal("codex"),
  Type.Literal("claude"),
  Type.Unsafe<`acp-${string}`>({ ...Type.String({ pattern: "^acp-[a-z0-9][a-z0-9-]{0,95}$" }) }),
]);
export type AgentEngine = Static<typeof AgentEngineSchema>;

/** Claude 只开放已支持映射的三档别名；两端与运行层共用固定名称，避免泄露映射后缀。 */
export const CLAUDE_MODEL_OPTIONS = [
  { id: "opus", displayName: "Opus" },
  { id: "sonnet", displayName: "Sonnet" },
  { id: "haiku", displayName: "Haiku" },
] as const;

export const ClaudePermissionModeSchema = Type.Union([
  Type.Literal("default"),
  // auto 由官方 SDK 判断模型、服务商与策略是否支持，两端必须原样传递。
  Type.Literal("auto"),
  Type.Literal("acceptEdits"),
  Type.Literal("plan"),
  Type.Literal("dontAsk"),
  Type.Literal("bypassPermissions"),
]);
export type ClaudePermissionMode = Static<typeof ClaudePermissionModeSchema>;

export const ClaudeSettingsSchema = Type.Object(
  {
    environmentOverrides: Type.Optional(
      Type.Array(Type.String({ maxLength: 128 }), { maxItems: 32 }),
    ),
    modelAliases: Type.Optional(
      Type.Object(
        {
          opus: Type.String({ maxLength: 256 }),
          sonnet: Type.String({ maxLength: 256 }),
          haiku: Type.String({ maxLength: 256 }),
        },
        { additionalProperties: false },
      ),
    ),
    model: Type.String({ minLength: 1, maxLength: 256 }),
    // 可选以兼容旧客户端；null 删除原生覆盖，省略则保留现有配置。
    modelContextWindow: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), Type.Null()]),
    ),
    autoCompactWindow: Type.Optional(
      Type.Union([Type.Integer({ minimum: 100000, maximum: 1000000 }), Type.Null()]),
    ),
    reasoningEffort: Type.Union([
      Type.Literal(""),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
      Type.Literal("xhigh"),
      Type.Literal("max"),
    ]),
    permissionMode: ClaudePermissionModeSchema,
    instructions: Type.String({ maxLength: 32_000 }),
    loadProjectSettings: Type.Boolean(),
    allowedTools: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      maxItems: 128,
      uniqueItems: true,
    }),
    disallowedTools: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      maxItems: 128,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
export type ClaudeSettings = Static<typeof ClaudeSettingsSchema>;
export const DEFAULT_CLAUDE_SETTINGS: ClaudeSettings = {
  modelContextWindow: null,
  autoCompactWindow: null,
  modelAliases: { opus: "", sonnet: "", haiku: "" },
  model: "default",
  reasoningEffort: "",
  permissionMode: "default",
  instructions: "",
  loadProjectSettings: true,
  allowedTools: [],
  disallowedTools: [],
};

// 兼容既有 Codex 设置封套，但独立声明 Claude 原生权限；绝不从 sandboxMode 推导。
export const AgentEngineOptionsSchema = Type.Object(
  {
    engine: Type.Literal("claude"),
    permissionMode: ClaudePermissionModeSchema,
  },
  { additionalProperties: false },
);
export type AgentEngineOptions = Static<typeof AgentEngineOptionsSchema>;

/** 旧会话没有显式字段时沿用 Codex，不能使用当前草稿的选择推断历史归属。 */
export function taskEngine(task: Readonly<{ engine?: AgentEngine }>): AgentEngine {
  return task.engine ?? "codex";
}

/** 新 Agent 使用可移植、不可包含路径的独立身份；旧任务身份保持不变。 */
export function isAgentEngine(value: unknown): value is AgentEngine {
  return (
    value === "codex" ||
    value === "claude" ||
    (typeof value === "string" && /^acp-[a-z0-9][a-z0-9-]{0,95}$/.test(value))
  );
}
export function agentEngineName(engine: AgentEngine): string {
  if (engine === "codex") return "Codex";
  if (engine === "claude") return "Claude";
  // 前缀与末尾的适配器标记属于引擎标识，展示时仅保留名称。
  return engine.slice(4).replace(/-acp$/u, "");
}
