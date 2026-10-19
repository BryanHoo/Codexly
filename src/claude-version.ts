import { readFile } from "node:fs/promises";

import { ClaudeVersionSchema } from "@codexly/protocol";

const VERSION_PATTERN = new RegExp(ClaudeVersionSchema.anyOf[0].pattern ?? "(?!)", "u");

/** 只读取实际 SDK 的包元数据，不启动 Claude，也不误用 PATH 中其他安装的 CLI。 */
export async function readClaudeCodeVersion(sdkEntry?: string): Promise<string | null> {
  try {
    const entry = sdkEntry ?? import.meta.resolve("@anthropic-ai/claude-agent-sdk");
    const manifest: unknown = JSON.parse(await readFile(new URL("./package.json", entry), "utf8"));
    if (manifest === null || typeof manifest !== "object" || !("claudeCodeVersion" in manifest))
      return null;
    const version = manifest.claudeCodeVersion;
    return typeof version === "string" && VERSION_PATTERN.test(version) ? version : null;
  } catch {
    // 旧版 SDK 或不完整的本地安装仅影响版本显示，不能阻止应用启动及更新检查。
    return null;
  }
}
