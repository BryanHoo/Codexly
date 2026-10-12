import { open } from "node:fs/promises";
import { join } from "node:path";

// 只读取模型发现需要的 API Key；不把 ChatGPT Token、认证文件或请求头交给前端和日志。
export async function readCustomModelHeaders(
  config: Record<string, unknown>,
  codexHome?: string,
): Promise<Record<string, string>> {
  try {
    return await loadCustomModelHeaders(config, codexHome);
  } catch {
    throw new Error("Custom provider API authentication is unavailable");
  }
}

async function loadCustomModelHeaders(
  config: Record<string, unknown>,
  codexHome?: string,
): Promise<Record<string, string>> {
  const providerId =
    typeof config["model_provider"] === "string" ? config["model_provider"] : "openai";
  const providers = config["model_providers"] as
    Record<string, Record<string, unknown>> | undefined;
  const provider = providers?.[providerId] ?? {};
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(provider["http_headers"] ?? {})) {
    if (typeof value === "string") headers[name] = value;
  }
  for (const [name, value] of Object.entries(provider["env_http_headers"] ?? {})) {
    if (typeof value === "string") {
      const header = process.env[value];
      if (header !== undefined) headers[name] = header;
    }
  }
  let apiKey =
    typeof provider["experimental_bearer_token"] === "string"
      ? provider["experimental_bearer_token"]
      : undefined;
  if (apiKey === undefined && typeof provider["env_key"] === "string") {
    apiKey = process.env[provider["env_key"]];
    if (apiKey === undefined)
      throw new Error("Custom provider API key environment variable is unavailable");
  }
  const hasAuthHeader = Object.keys(headers).some((name) =>
    ["authorization", "x-api-key", "x-goog-api-key"].includes(name.toLowerCase()),
  );
  if (
    apiKey === undefined &&
    !hasAuthHeader &&
    provider["requires_openai_auth"] !== false &&
    codexHome !== undefined
  ) {
    const file = await open(join(codexHome, "auth.json"), "r");
    try {
      if ((await file.stat()).size > 1024 * 1024)
        throw new Error("Codex authentication file exceeded the size limit");
      const auth = JSON.parse(await file.readFile("utf8")) as Record<string, unknown>;
      if (typeof auth["OPENAI_API_KEY"] === "string") apiKey = auth["OPENAI_API_KEY"];
    } finally {
      await file.close();
    }
  }
  if (apiKey !== undefined && apiKey.trim().length > 0)
    headers["authorization"] = `Bearer ${apiKey}`;
  return headers;
}
