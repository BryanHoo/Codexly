import { isSupportedClaudeCommand } from "./commands.js";
import { homedir } from "node:os";
import { query, getSessionMessages, getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEngineService, AgentTaskScope, LocalCatalogStore } from "@codexly/core";
import type {
  AgentEngineProfile,
  ClaudeSettings,
  ConfigureCustomProviderRequest,
} from "@codexly/protocol";
import { ClaudeConfiguration, claudeEnvironment } from "./config.js";
import { ClaudeAgentProvider, CLAUDE_CAPABILITIES, type ClaudeSdk } from "./provider.js";

export class ClaudeRuntime implements AgentEngineService {
  readonly configuration: ClaudeConfiguration;
  readonly #providers = new Map<string, ClaudeAgentProvider>();
  readonly #catalogs = new Map<string, { expires: number; value: Promise<AgentEngineProfile> }>();

  constructor(
    directory: string,
    readonly store: LocalCatalogStore,
    readonly sdk: ClaudeSdk = { query, getSessionMessages, getSessionInfo },
  ) {
    this.configuration = new ClaudeConfiguration(directory);
  }

  readSettings() {
    return this.configuration.readSettings();
  }
  async writeSettings(settings: ClaudeSettings) {
    const saved = await this.configuration.writeSettings(settings);
    this.#catalogs.clear();
    return saved;
  }

  forScope(scope: AgentTaskScope): ClaudeAgentProvider {
    let provider = this.#providers.get(scope.id);
    if (!provider) {
      // 桌面项目切换不销毁应用，及时回收空闲适配器及其最近回合缓存。
      if (this.#providers.size >= 16) {
        for (const [id, candidate] of this.#providers) {
          if (!candidate.isBusy) {
            candidate.close();
            this.#providers.delete(id);
            break;
          }
        }
        if (this.#providers.size >= 16) throw new Error("Claude active project capacity exceeded");
      }
      provider = new ClaudeAgentProvider(scope, this.store, this.configuration, this.sdk, () =>
        this.inspect(scope),
      );
      this.#providers.set(scope.id, provider);
    }
    return provider;
  }

  async inspect(scope?: AgentTaskScope): Promise<AgentEngineProfile> {
    const connection = await this.configuration.status();
    if (connection.state !== "connected")
      return {
        engine: "claude",
        connection,
        capabilities: CLAUDE_CAPABILITIES,
        models: { data: [], nextCursor: null },
        commands: [],
        settings: await this.readSettings(),
      };
    const cwd = scope?.rootPath ?? homedir();
    const cached = this.#catalogs.get(cwd);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = this.#discover(cwd).catch((error: unknown) => {
      if (this.#catalogs.get(cwd)?.value === value) this.#catalogs.delete(cwd);
      throw error;
    });
    this.#catalogs.set(cwd, { expires: Date.now() + 60_000, value });
    while (this.#catalogs.size > 16) {
      const oldest = this.#catalogs.keys().next().value;
      if (oldest !== undefined) this.#catalogs.delete(oldest);
    }
    return value;
  }

  async #discover(cwd: string): Promise<AgentEngineProfile> {
    const credentials = await this.configuration.credentials();
    const defaults = await this.readSettings();
    const gate = Promise.withResolvers<undefined>(),
      controller = new AbortController();
    const stream = this.sdk.query({
      prompt: (async function* () {
        await gate.promise;
        yield* [];
      })(),
      options: {
        cwd,
        env: claudeEnvironment(credentials),
        abortController: controller,
        persistSession: false,
        settingSources: defaults.loadProjectSettings ? ["project", "local"] : [],
        settings: { apiKeyHelper: "", forceLoginMethod: "console" },
      },
    });
    const expired = Promise.withResolvers<never>();
    const timeout = setTimeout(() => {
      controller.abort();
      expired.reject(new Error("Claude capability discovery timed out"));
    }, 20_000);
    timeout.unref();
    try {
      const [models, commands] = await Promise.race([
        Promise.all([stream.supportedModels(), stream.supportedCommands()]),
        expired.promise,
      ]);
      const data = credentials.models?.length
        ? credentials.models.map((model, index) => ({
            id: model.id,
            displayName: model.name,
            description: "",
            isDefault: index === 0,
            defaultReasoningEffort: "",
            supportedReasoningEfforts: [],
          }))
        : models.map((model, index) => ({
            id: model.value,
            displayName: model.displayName,
            description: model.description,
            isDefault: index === 0,
            defaultReasoningEffort: "",
            supportedReasoningEfforts: (model.supportedEffortLevels ?? []).map((id) => ({
              id,
              description: id,
            })),
          }));
      return {
        engine: "claude",
        capabilities: CLAUDE_CAPABILITIES,
        connection: await this.configuration.status(),
        settings: await this.readSettings(),
        configuredModels: credentials.models ?? [],
        models: { data, nextCursor: null },
        commands: commands
          .filter((command) => isSupportedClaudeCommand(command.name))
          .map((command) => ({
            name: command.name,
            description: command.description,
            argumentHint: command.argumentHint,
          })),
      };
    } finally {
      clearTimeout(timeout);
      gate.resolve(undefined);
      stream.close();
    }
  }

  async configure(input: ConfigureCustomProviderRequest) {
    await this.configuration.configure(input);
    this.#catalogs.clear();
    const profile = await this.inspect();
    return { models: profile.models, status: profile.connection };
  }

  async disconnect() {
    // 断开只修改 Claude 自身配置，不注销宿主机 CLI 的账号，也不影响 Codex。
    for (const provider of this.#providers.values()) provider.close();
    this.#providers.clear();
    this.#catalogs.clear();
    await this.configuration.clear();
    return { status: await this.configuration.status() };
  }

  release(projectId: string): void {
    this.#providers.get(projectId)?.close();
    this.#providers.delete(projectId);
  }
  close(): void {
    for (const provider of this.#providers.values()) provider.close();
    this.#providers.clear();
    this.#catalogs.clear();
  }
}
