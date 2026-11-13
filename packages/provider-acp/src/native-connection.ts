import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import type { AgentEngine } from "@codexly/protocol";

export interface NativeConnection {
  baseUrl?: string;
  apiType: string;
  headers: Record<string, string>;
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
async function read(path: string): Promise<string | undefined> {
  try {
    const file = await open(path, "r");
    try {
      if ((await file.stat()).size > 1024 * 1024) return;
      return await file.readFile("utf8");
    } finally {
      await file.close();
    }
  } catch {
    return;
  }
}
function endpoint(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return;
  try {
    const url = new URL(raw);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
      return raw;
  } catch {
    /* 无效原生配置不能以空值覆盖用户的设置。 */
  }
  return;
}

/** 只读 CLI 的有效配置，密钥仅供宿主复用；公开响应只返回地址及是否已配置。 */
export async function readNativeConnection(
  engine: AgentEngine,
  environment: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): Promise<NativeConnection | undefined> {
  try {
    if (engine === "codex") {
      const directory = text(environment["CODEX_HOME"]) ?? join(home, ".codex");
      const config = object(parse((await read(join(directory, "config.toml"))) ?? ""));
      const profile = object(object(config["profiles"])[text(config["profile"]) ?? ""]);
      const effective = { ...config, ...profile };
      const provider = object(
        object(config["model_providers"])[text(effective["model_provider"]) ?? "openai"],
      );
      const authText = await read(join(directory, "auth.json"));
      const auth = object(authText ? JSON.parse(authText) : {});
      const envKey = text(provider["env_key"]);
      const key =
        (envKey ? text(environment[envKey]) : undefined) ??
        text(provider["experimental_bearer_token"]) ??
        (provider["requires_openai_auth"] !== false
          ? (text(environment["CODEX_API_KEY"]) ??
            text(environment["OPENAI_API_KEY"]) ??
            text(auth["OPENAI_API_KEY"]))
          : undefined);
      const baseUrl = endpoint(provider["base_url"] ?? effective["openai_base_url"]);
      if (!baseUrl && !key) return;
      return {
        ...(baseUrl ? { baseUrl } : {}),
        apiType: "openai",
        headers: key ? { Authorization: `Bearer ${key}` } : {},
      };
    }
    const directory = text(environment["CLAUDE_CONFIG_DIR"]) ?? join(home, ".claude");
    const content = await read(join(directory, "settings.json"));
    const env = {
      ...object(object(content ? JSON.parse(content) : {})["env"]),
      ...Object.fromEntries(Object.entries(environment).filter(([, value]) => value !== undefined)),
    };
    const baseUrl = endpoint(env["ANTHROPIC_BASE_URL"]);
    const apiKey = text(env["ANTHROPIC_API_KEY"]),
      token = text(env["ANTHROPIC_AUTH_TOKEN"]);
    if (!baseUrl && !apiKey && !token) return;
    return {
      ...(baseUrl ? { baseUrl } : {}),
      apiType: "anthropic",
      headers: token ? { Authorization: `Bearer ${token}` } : apiKey ? { "x-api-key": apiKey } : {},
    };
  } catch {
    return;
  }
}
