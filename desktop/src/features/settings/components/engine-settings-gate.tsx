import type { AgentEngine } from "@codexly/protocol";
import type { ReactNode } from "react";
import { getCurrentLanguage } from "../../../i18n/i18n.js";

/** 安装包已包含运行时，设置直接开放连接配置；访问设置不等同于启用引擎。 */
export function EngineSettingsGate({ engine, children }: Readonly<{ engine: AgentEngine; children?: ReactNode }>) {
  if (engine === "claude" && import.meta.env.VITE_MACOS_LEGACY === "true") {
    return <p role="status">{getCurrentLanguage() === "zh-CN" ? "此系统版本不支持 Claude。" : "Claude is not supported on this system version."}</p>;
  }
  return children;
}
