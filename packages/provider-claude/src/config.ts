import { ClaudeHistory } from "./history.js";
import { ClaudePersistence } from "./persistence.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
  apiKey?: string;
  authToken?: string;
  baseUrl: string;
  models?: ConfigureCustomProviderRequest["models"];
}>;

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())),
        ),
      ]
    : [];
}
function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (missing(error)) return "";
    throw error;
  }
}
async function readObject(path: string): Promise<JsonObject> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (missing(error)) return {};
    throw error;
  }
  const value: unknown = JSON.parse(raw);
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Claude user settings");
  return value as JsonObject;
}
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
  readonly userDirectory: string;
  readonly history: ClaudeHistory;
  readonly persistence: ClaudePersistence;
  #write: Promise<unknown> = Promise.resolve();

  constructor(
    directory: string,
    userDirectory = text(process.env["CLAUDE_CONFIG_DIR"]) ?? join(homedir(), ".claude"),
  ) {
    this.#directory = directory;
    this.userDirectory = resolve(userDirectory);
    // 只有应用历史投影与项目加载偏好留在私有目录；原生配置始终以用户文件为准。
    this.history = new ClaudeHistory(join(directory, "transcripts"));
    this.persistence = new ClaudePersistence(this.history);
  }

  #native() {
    return readObject(join(this.userDirectory, "settings.json"));
  }

  #environment(native: JsonObject): Record<string, string | undefined> {
    const env = Object.fromEntries(
      Object.entries(object(native["env"])).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    // 与 CLI 一样保留宿主环境优先级，不清除代理、模型别名或第三方后端认证。
    return {
      ...env,
      ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => Boolean(value))),
    };
  }
  environment(): Record<string, string | undefined> {
    return { ...claudeEnvironment(), CLAUDE_CONFIG_DIR: this.userDirectory };
  }

  async readSettings(): Promise<ClaudeSettings> {
    const [native, preferences, instructions] = await Promise.all([
      this.#native(),
      readObject(join(this.#directory, "preferences.json")),
      readText(join(this.userDirectory, "CLAUDE.md")),
    ]);
    const env = this.#environment(native),
      permissions = object(native["permissions"]);
    const settings = {
      model: text(env["ANTHROPIC_MODEL"]) ?? text(native["model"]) ?? DEFAULT_CLAUDE_SETTINGS.model,
      reasoningEffort: text(env["CLAUDE_CODE_EFFORT_LEVEL"]) ?? text(native["effortLevel"]) ?? "",
      permissionMode: permissions["defaultMode"] ?? "default",
      instructions,
      loadProjectSettings: preferences["loadProjectSettings"] !== false,
      allowedTools: strings(permissions["allow"]),
      disallowedTools: strings(permissions["deny"]),
    };
    // 原生文件还允许未来扩展值；公共表单只投影当前支持的枚举。
    // 权限的 default 可能只是兼容投影，保存时必须保留磁盘上的未支持模式。
    if (!Value.Check(ClaudeSettingsSchema.properties.reasoningEffort, settings.reasoningEffort))
      settings.reasoningEffort = "";
    if (!Value.Check(ClaudeSettingsSchema.properties.permissionMode, settings.permissionMode))
      settings.permissionMode = "default";
    return settings as ClaudeSettings;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#write.then(operation);
    this.#write = result.catch(() => undefined);
    return result;
  }

  writeSettings(settings: ClaudeSettings): Promise<ClaudeSettings> {
    if (!Value.Check(ClaudeSettingsSchema, settings))
      return Promise.reject(new Error("Invalid Claude settings"));
    const snapshot = structuredClone(settings);
    return this.#enqueue(async () => {
      const native = await this.#native();
      this.#mergeSettings(native, snapshot);
      // 每次从磁盘合并最新内容，只修改表单负责的键，保留 hooks、插件、ask 等原生设置。
      await this.#persist(
        join(this.userDirectory, "settings.json"),
        JSON.stringify(native, null, 2) + "\n",
      );
      await this.#persist(join(this.userDirectory, "CLAUDE.md"), snapshot.instructions);
      await this.#persist(
        join(this.#directory, "preferences.json"),
        JSON.stringify({
          ...(await readObject(join(this.#directory, "preferences.json"))),
          loadProjectSettings: snapshot.loadProjectSettings,
        }),
      );
      return this.readSettings();
    });
  }

  #mergeSettings(native: JsonObject, snapshot: ClaudeSettings): void {
    const permissions = object(native["permissions"]);
    // auto 等原生模式尚未暴露给表单，default 可能来自读取时的降级投影。
    // 全量提交无法证明用户主动切换到了 default，因此保留最新原生值；
    // 只有选择其他受支持模式时才覆盖，避免仅修改指令也悄悄重置权限。
    const preserveNativeMode =
      snapshot.permissionMode === "default" &&
      "defaultMode" in permissions &&
      !Value.Check(ClaudeSettingsSchema.properties.permissionMode, permissions["defaultMode"]);
    native["model"] = snapshot.model;
    // max 是单次执行档位，原生持久化只接受到 xhigh；用官方环境变量保存 max。
    if (snapshot.reasoningEffort && snapshot.reasoningEffort !== "max")
      native["effortLevel"] = snapshot.reasoningEffort;
    else delete native["effortLevel"];
    const env = { ...object(native["env"]) };
    if ("ANTHROPIC_MODEL" in env) env["ANTHROPIC_MODEL"] = snapshot.model;
    if (snapshot.reasoningEffort === "max" || "CLAUDE_CODE_EFFORT_LEVEL" in env) {
      if (snapshot.reasoningEffort) env["CLAUDE_CODE_EFFORT_LEVEL"] = snapshot.reasoningEffort;
      else delete env["CLAUDE_CODE_EFFORT_LEVEL"];
    }
    if (Object.keys(env).length || "env" in native) native["env"] = env;
    native["permissions"] = {
      ...permissions,
      defaultMode: preserveNativeMode ? permissions["defaultMode"] : snapshot.permissionMode,
      allow: snapshot.allowedTools,
      deny: snapshot.disallowedTools,
    };
  }

  async credentials(): Promise<ClaudeCredentials | undefined> {
    const native = await this.#native(),
      env = this.#environment(native);
    const apiKey = text(env["ANTHROPIC_API_KEY"]),
      authToken = text(env["ANTHROPIC_AUTH_TOKEN"]);
    const models = strings(native["availableModels"]);
    if (!models.length) {
      for (const [key, value] of Object.entries(env)) {
        if (
          /^ANTHROPIC_(?:MODEL|DEFAULT_.*_MODEL)$/u.test(key) &&
          typeof value === "string" &&
          value.trim()
        )
          models.push(value);
      }
    }
    if (!apiKey && !authToken && !models.length && !text(env["ANTHROPIC_BASE_URL"]))
      return undefined;
    return {
      ...(apiKey ? { apiKey } : {}),
      ...(authToken ? { authToken } : {}),
      baseUrl: text(env["ANTHROPIC_BASE_URL"]) ?? "https://api.anthropic.com",
      models: [...new Set(models)].map((id) => ({ id, name: id })),
    };
  }

  async status(): Promise<AgentProviderConnectionStatus> {
    const credentials = await this.credentials();
    const custom =
      Boolean(credentials?.apiKey) ||
      Boolean(credentials?.authToken) ||
      (credentials?.baseUrl !== undefined && credentials.baseUrl !== "https://api.anthropic.com");
    // 本机 OAuth、钥匙串、apiKeyHelper 和云认证交给 SDK；对外绝不返回密钥。
    return {
      mode: custom ? "custom" : "official",
      state:
        Boolean(credentials?.apiKey) || Boolean(credentials?.authToken)
          ? "connected"
          : "disconnected",
      account:
        Boolean(credentials?.apiKey) || Boolean(credentials?.authToken) ? { type: "apiKey" } : null,
      customBaseUrl: custom ? (credentials?.baseUrl ?? null) : null,
      pendingLogin: null,
    };
  }

  async revision(cwd: string): Promise<string> {
    // 内容摘要保证同一时钟粒度内的外部配置编辑也能使目录缓存失效；不保存明文凭据。
    const files = [
      join(this.userDirectory, "settings.json"),
      join(this.userDirectory, "CLAUDE.md"),
      join(this.#directory, "preferences.json"),
    ];
    const contents = await Promise.all(files.map(readText));
    const metadata = await Promise.all(
      [
        join(this.userDirectory, ".credentials.json"),
        join(this.userDirectory, ".claude.json"),
        join(homedir(), ".claude.json"),
        join(cwd, ".claude", "settings.json"),
        join(cwd, ".claude", "settings.local.json"),
      ].map(async (path) => {
        try {
          const info = await stat(path);
          return [info.mtimeMs, info.ctimeMs, info.size];
        } catch (error) {
          if (missing(error)) return null;
          throw error;
        }
      }),
    );
    return createHash("sha256")
      .update(JSON.stringify([contents, metadata, process.env]))
      .digest("hex");
  }

  async #persist(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  configure(input: ConfigureCustomProviderRequest): Promise<void> {
    if (!Value.Check(ConfigureCustomProviderRequestSchema, input))
      return Promise.reject(new Error("Invalid Claude connection configuration"));
    const snapshot = structuredClone(input);
    return this.#enqueue(async () => {
      const baseUrl = normalizeEndpoint(snapshot.baseUrl),
        native = await this.#native();
      const previous = await this.credentials();
      const apiKey =
        text(snapshot.apiKey?.trim()) ??
        (previous?.baseUrl === baseUrl ? previous.apiKey : undefined);
      const authToken =
        !snapshot.apiKey?.trim() && previous?.baseUrl === baseUrl ? previous.authToken : undefined;
      if (!apiKey && !authToken && baseUrl !== (previous?.baseUrl ?? "https://api.anthropic.com"))
        throw new Error("An explicit Claude API key is required for this endpoint");
      const env = { ...object(native["env"]), ANTHROPIC_BASE_URL: baseUrl };
      delete (env as JsonObject)["ANTHROPIC_API_KEY"];
      delete (env as JsonObject)["ANTHROPIC_AUTH_TOKEN"];
      native["env"] = {
        ...env,
        ...(apiKey
          ? { ANTHROPIC_API_KEY: apiKey }
          : authToken
            ? { ANTHROPIC_AUTH_TOKEN: authToken }
            : {}),
      };
      if (snapshot.models !== undefined) {
        if (snapshot.models.length)
          native["availableModels"] = snapshot.models.map((model) => model.id);
        else delete native["availableModels"];
      }
      await this.#persist(
        join(this.userDirectory, "settings.json"),
        JSON.stringify(native, null, 2) + "\n",
      );
    });
  }

  clear(): Promise<void> {
    return this.#enqueue(async () => {
      const native = await this.#native(),
        env = { ...object(native["env"]) };
      delete env["ANTHROPIC_API_KEY"];
      delete env["ANTHROPIC_AUTH_TOKEN"];
      delete env["ANTHROPIC_BASE_URL"];
      native["env"] = env;
      await this.#persist(
        join(this.userDirectory, "settings.json"),
        JSON.stringify(native, null, 2) + "\n",
      );
    });
  }
}

export function claudeEnvironment(
  credentials?: ClaudeCredentials,
  inherited: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  // 只移除嵌套 CLI 检测标志；保留用户的认证、模型、云服务商与代理配置交给官方 SDK。
  const { CLAUDECODE: _nested, ...environment } = inherited;
  return {
    ...environment,
    ...(credentials?.apiKey ? { ANTHROPIC_API_KEY: credentials.apiKey } : {}),
    ...(credentials?.authToken ? { ANTHROPIC_AUTH_TOKEN: credentials.authToken } : {}),
    ...(credentials ? { ANTHROPIC_BASE_URL: credentials.baseUrl } : {}),
    CLAUDE_AGENT_SDK_CLIENT_APP: "codexly",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}
