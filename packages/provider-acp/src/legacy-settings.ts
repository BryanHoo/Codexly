import { open } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEngine } from "@codexly/protocol";
import type { AcpLegacySettingsSnapshot } from "./settings-store.js";
// 与旧应用文件的公共偏好边界一致；这些字段继续由原偏好入口读取，不当作 agent 配置迁移。
const preferences = new Set([
  "taskTitlePrompt",
  "promptOptimizationPrompt",
  "defaultAgent",
  "defaultModel",
  "commitMessagePrompt",
  "defaultOpenAppId",
  "followUpBehavior",
  "pet",
]);
const budget = 512 * 1024;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid application settings");
  return value as Record<string, unknown>;
}
async function read(path: string): Promise<Record<string, unknown> | undefined> {
  let file;
  try {
    file = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw Error("无法读取旧应用设置，原文件保持不变", { cause: error });
  }
  try {
    if ((await file.stat()).size > budget) throw Error("budget");
    const buffer = Buffer.allocUnsafe(budget + 1);
    let length = 0;
    // 文件可能在 stat 后增长，最多多读一个字节识别超预算，避免无限读取外部写入。
    while (length < buffer.length) {
      const part = await file.read(buffer, length, buffer.length - length, null);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    if (length > budget) throw Error("budget");
    return object(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)),
      ) as unknown,
    );
  } catch {
    throw Error("旧应用设置无效或超出迁移预算，原文件保持不变");
  } finally {
    await file.close();
  }
}
/** 来源目录由可信应用装配注入，只读旧应用文件，不解析或改写厂商原生配置和凭据。 */
export async function readAcpLegacyApplicationSettings(
  applicationDirectory: string,
  engine: AgentEngine,
): Promise<AcpLegacySettingsSnapshot> {
  if (engine === "claude")
    return {
      settings: (await read(join(applicationDirectory, "engines/claude/preferences.json"))) ?? {},
      policy: "migrate",
    };
  const stored = await read(join(applicationDirectory, "agent-settings.json"));
  if (!stored) return { settings: {}, policy: "preserve" };
  if (stored["version"] !== 1) throw Error("不支持的旧应用设置版本，原文件保持不变");
  const global = object(stored["global"]);
  // Object.fromEntries 保留 __proto__ 等原始键；未知值只存私有 legacy，是否可用仍由 ACP 校验。
  return {
    settings: Object.fromEntries(Object.entries(global).filter(([key]) => !preferences.has(key))),
    policy: "preserve",
  };
}
