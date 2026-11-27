import type { AgentEngine } from "@codexly/protocol";
import type { RegistryAgent } from "./agent-installer.js";
import { findRegistryUpdate } from "./agent-registry-update.js";
import snapshot from "./registry-snapshot.json" with { type: "json" };

// CodeFree O 由 Codexly 补充到内置目录，固定为已验证无界面服务接口的 npm 版本。
export const codefreeAgent: RegistryAgent & { description: string } = {
  id: "codefree-o",
  name: "CodeFree O",
  version: "1.11.2",
  description: "CodeFree O coding agent",
  distribution: {
    npx: { package: "@srdcloud/codefree-o@1.11.2", args: ["serve"] },
  },
};

function engineOf(id: string): AgentEngine {
  return id === "codex-acp" ? "codex" : id === "claude-acp" ? "claude" : `acp-${id}`;
}

export const registry = new Map<AgentEngine, RegistryAgent & { description: string }>(
  [...snapshot.agents, codefreeAgent].map((entry) => [engineOf(entry.id), entry]),
);

export const registryAliases: Record<string, string[]> = {
  "codex-acp": ["codex"],
  "claude-acp": ["claude"],
  gemini: ["gemini"],
  cursor: ["cursor-agent"],
  "github-copilot-cli": ["copilot"],
  "qwen-code": ["qwen"],
  "mistral-vibe": ["vibe-acp"],
  "codebuddy-code": ["codebuddy"],
  "pi-acp": ["pi"],
  "factory-droid": ["droid"],
  "kimi-code": ["kimi-code"],
  "fast-agent": ["fast-agent-acp"],
  "grok-build": ["grok"],
  "antigravity-acp": ["agy_acp_server"],
  // Windows 的 npm 全局安装把原生入口放在同级 node_modules 下，可直接启动。
  ...(process.platform === "win32"
    ? { "codefree-o": ["node_modules/@srdcloud/codefree-o/bin/codefree-o", "codefree-o"] }
    : {}),
};

export async function findAgentUpdate(
  entry: RegistryAgent,
  installedVersion: string | undefined,
  signal: AbortSignal,
): Promise<RegistryAgent | undefined> {
  if (entry !== codefreeAgent) return findRegistryUpdate(entry, installedVersion, signal);
  // CodeFree O 的更新以 Codexly 随附的版本为准，避免向上游目录查询补充条目。
  if (
    !installedVersion ||
    entry.version.localeCompare(installedVersion, "en", { numeric: true }) > 0
  )
    return entry;
}
