import { ClaudeHistory } from "./history.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentProviderConnectionStatus,
  ConfigureCustomProviderRequest,
} from "@codexly/protocol";
import {
  ClaudeSettingsSchema,
  ConfigureCustomProviderRequestSchema,
  DEFAULT_CLAUDE_SETTINGS,
  type ClaudeSettings,
} from "@codexly/protocol";
import { Value } from "@sinclair/typebox/value";

export type ClaudeCredentials = Readonly<{
  apiKey: string;
  baseUrl: string;
  models?: ConfigureCustomProviderRequest["models"];
}>;

function normalizeEndpoint(value: string): string {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Claude endpoint must be an HTTP(S) URL without credentials, query or fragment",
    );
  return url.href.replace(/\/+$/u, "");
}

export class ClaudeConfiguration {
  readonly #directory: string;
  readonly history: ClaudeHistory;
  #write: Promise<unknown> = Promise.resolve();

  constructor(directory: string) {
    this.#directory = directory;
    this.history = new ClaudeHistory(join(directory, "transcripts"));
  }

  async readSettings(): Promise<ClaudeSettings> {
    try {
      const value: unknown = JSON.parse(
        await readFile(join(this.#directory, "settings.json"), "utf8"),
      );
      if (!Value.Check(ClaudeSettingsSchema, value)) throw new Error("Invalid Claude settings");
      return value;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return structuredClone(DEFAULT_CLAUDE_SETTINGS);
      throw error;
    }
  }

  writeSettings(settings: ClaudeSettings): Promise<ClaudeSettings> {
    if (!Value.Check(ClaudeSettingsSchema, settings))
      return Promise.reject(new Error("Invalid Claude settings"));
    const snapshot = structuredClone(settings);
    const operation = this.#write.then(async () => {
      await this.#persist(snapshot, "settings.json");
      return snapshot;
    });
    this.#write = operation.catch(() => undefined);
    return operation;
  }

  async #read(): Promise<ClaudeCredentials | undefined> {
    try {
      const raw: unknown = JSON.parse(
        await readFile(join(this.#directory, "connection.json"), "utf8"),
      );
      if (raw === null) return undefined;
      if (
        typeof raw !== "object" ||
        !("apiKey" in raw) ||
        typeof raw.apiKey !== "string" ||
        !raw.apiKey.trim() ||
        !("baseUrl" in raw) ||
        typeof raw.baseUrl !== "string"
      )
        throw new Error("Invalid Claude connection configuration");
      normalizeEndpoint(raw.baseUrl);
      return raw as ClaudeCredentials;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async credentials(): Promise<ClaudeCredentials> {
    const value = await this.#read();
    if (!value) throw new Error("Configure a Claude API key before starting a conversation");
    return value;
  }

  async status(): Promise<AgentProviderConnectionStatus> {
    const config = await this.#read();
    // 公共状态只报告是否配置，不把密钥、环境变量或官方账号写入前端状态。
    return {
      mode: "custom",
      state: config ? "connected" : "disconnected",
      account: config ? { type: "apiKey" } : null,
      customBaseUrl: config?.baseUrl ?? null,
      pendingLogin: null,
    };
  }

  async #persist(
    value: ClaudeCredentials | ClaudeSettings | null,
    name = "connection.json",
  ): Promise<void> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const path = join(this.#directory, name);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  configure(input: ConfigureCustomProviderRequest): Promise<void> {
    if (!Value.Check(ConfigureCustomProviderRequestSchema, input))
      return Promise.reject(new Error("Invalid Claude connection configuration"));
    const operation = this.#write.then(async () => {
      const baseUrl = normalizeEndpoint(input.baseUrl);
      const previous = await this.#read();
      const apiKey =
        (input.apiKey?.trim() ? input.apiKey.trim() : undefined) ??
        (previous?.baseUrl === baseUrl ? previous.apiKey : undefined);
      if (!apiKey) throw new Error("An explicit Claude API key is required for this endpoint");
      await this.#persist({
        apiKey,
        baseUrl,
        ...((input.models ?? previous?.models) ? { models: input.models ?? previous?.models } : {}),
      });
    });
    this.#write = operation.catch(() => undefined);
    return operation;
  }

  clear(): Promise<void> {
    const operation = this.#write.then(() => this.#persist(null));
    this.#write = operation.catch(() => undefined);
    return operation;
  }
}

export function claudeEnvironment(
  credentials: ClaudeCredentials,
  inherited: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  // SDK 的 env 完整替换子进程环境；保留 PATH/代理/系统变量，清除其他引擎和旧认证路由。
  const environment = Object.fromEntries(
    Object.entries(inherited).filter(
      ([key]) => !/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$|CODEX_)/u.test(key),
    ),
  );
  return {
    ...environment,
    ANTHROPIC_API_KEY: credentials.apiKey,
    ANTHROPIC_BASE_URL: credentials.baseUrl,
    CLAUDE_AGENT_SDK_CLIENT_APP: "codexly",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}
