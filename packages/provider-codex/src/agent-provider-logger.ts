import pino from "pino";

export interface CodexProviderLogger {
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

// Logger 契约独立于 Provider 基类，避免诊断模块为类型复用反向依赖运行时实现。
export const DEFAULT_PROVIDER_LOGGER: CodexProviderLogger = pino({ level: "warn" }).child({
  component: "provider-codex",
});
