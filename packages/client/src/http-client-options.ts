import type { AgentEngine } from "@codexly/protocol";

export type EngineSettingsScope = Readonly<{ engine?: AgentEngine }>;
/** 缺省路径保留既有 Codex 协议，Claude 公共偏好显式绕过 Codex 原生配置。 */
export function engineSettingsPath(options: EngineSettingsScope): string {
  return options.engine === "claude" ? "/v1/settings?engine=claude" : "/v1/settings";
}

export type ReadOptions = Readonly<{ signal?: AbortSignal }>;
export type MutationOptions = Readonly<{ idempotencyKey?: string; signal?: AbortSignal }>;
