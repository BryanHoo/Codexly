import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentProviderConnectionStatus } from "@codexly/protocol";

/** 只判断 Codex 是否已配置，不启动 App Server，也不返回认证内容。 */
export async function readLocalGenerationConnection(
  codexHome: string,
): Promise<AgentProviderConnectionStatus> {
  const [authText, config] = await Promise.all([
    readFile(join(codexHome, "auth.json"), "utf8").catch(() => "{}"),
    readFile(join(codexHome, "config.toml"), "utf8").catch(() => ""),
  ]);
  let authenticated = false;
  try {
    const auth: unknown = JSON.parse(authText);
    if (auth && typeof auth === "object")
      authenticated =
        ("OPENAI_API_KEY" in auth &&
          typeof auth.OPENAI_API_KEY === "string" &&
          Boolean(auth.OPENAI_API_KEY.trim())) ||
        ("tokens" in auth &&
          auth.tokens !== null &&
          typeof auth.tokens === "object" &&
          "access_token" in auth.tokens &&
          Boolean(auth.tokens.access_token));
  } catch {
    /* 损坏的认证文件不视为已配置，具体认证错误仍由原生引擎报告。 */
  }
  const custom = /^\s*model_provider\s*=\s*["'](?!openai["'])[^"']+["']/mu.test(config);
  return {
    account: null,
    pendingLogin: null,
    customBaseUrl: null,
    mode: custom ? "custom" : "official",
    state: authenticated || custom ? "connected" : "disconnected",
  };
}
