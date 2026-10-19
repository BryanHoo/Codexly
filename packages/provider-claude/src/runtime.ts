import type { TaskTitleGenerator } from "@codexly/core";
import { CLAUDE_MODEL_OPTIONS } from "@codexly/protocol";
import { isSupportedClaudeCommand } from "./commands.js";
import { generateClaudeCommitMessage } from "./commit-message.js";
import { generateTitle } from "./task-titles.js";
import { homedir } from "node:os";
import {
  query,
  getSessionMessages,
  getSessionInfo,
  deleteSession,
  forkSession,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentEngineService, AgentTaskScope, LocalCatalogStore } from "@codexly/core";
import type {
  AgentEngineProfile,
  ClaudeSettings,
  ConfigureCustomProviderRequest,
} from "@codexly/protocol";
import { ClaudeConfiguration } from "./config.js";
import { ClaudeAgentProvider, CLAUDE_CAPABILITIES, type ClaudeSdk } from "./provider.js";
import { searchClaudeOccurrences } from "./global-search.js";
import {
  checkSearchCancellation,
  type AgentSearchScope,
  type AgentCancellationSignal,
} from "@codexly/core";
import type { SearchOccurrencesQuery } from "@codexly/protocol";

export class ClaudeRuntime implements AgentEngineService {
  setTaskTitleGenerator(generate: TaskTitleGenerator): void {
    this.configuration.taskTitleGenerator = generate;
  }
  async generateTaskTitle(
    cwd: string,
    text: string,
    model: string,
    signal: AbortSignal,
    instructions = "",
  ): Promise<string> {
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      return await generateTitle(
        this.sdk,
        this.configuration,
        { cwd },
        text,
        controller,
        model,
        instructions,
      );
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  readonly configuration: ClaudeConfiguration;
  readonly #providers = new Map<string, ClaudeAgentProvider>();
  readonly #commitRequests = new Set<AbortController>();
  readonly #catalogs = new Map<
    string,
    { expires: number; revision: string; value: Promise<AgentEngineProfile> }
  >();

  constructor(
    directory: string,
    readonly store: LocalCatalogStore,
    readonly sdk: ClaudeSdk = {
      query,
      getSessionMessages,
      getSessionInfo,
      deleteSession,
      forkSession,
    },
  ) {
    this.configuration = new ClaudeConfiguration(directory);
  }

  readSettings() {
    return this.configuration.readSettings();
  }
  async searchTaskOccurrences(
    taskId: string,
    input: SearchOccurrencesQuery,
    scope: AgentSearchScope,
    signal?: AgentCancellationSignal,
    limit = 30,
  ) {
    checkSearchCancellation(signal);
    const task = await this.store.catalog("task.read", { id: taskId });
    checkSearchCancellation(signal);
    if (
      task?.provider !== "claude" ||
      task.projectId !== (scope.kind === "temporary" ? null : scope.id)
    )
      throw new Error("Claude search task does not belong to the requested project");
    return searchClaudeOccurrences(this.configuration.history, taskId, input, signal, limit);
  }
  generateCommitMessage(prompt: string, model: string): Promise<string> {
    // 辅助推理与聊天分开限流，防止多窗口同时生成说明造成 SDK 进程峰值。
    if (this.#commitRequests.size >= 2)
      return Promise.reject(new Error("Claude commit generation capacity exceeded"));
    const controller = new AbortController();
    this.#commitRequests.add(controller);
    return generateClaudeCommitMessage(
      this.configuration,
      this.sdk,
      prompt,
      model,
      controller,
    ).finally(() => this.#commitRequests.delete(controller));
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
    const cwd = scope?.rootPath ?? homedir();
    // 全局探测只读取用户配置，不能把主目录下的 .claude 误当成项目配置。
    // 同一路径作为真实项目时仍允许项目设置，因此缓存身份也必须包含探测范围。
    const key = `${scope ? "project" : "global"}\0${cwd}`;
    const revision = await this.configuration.revision(cwd);
    const cached = this.#catalogs.get(key);
    if (cached?.revision === revision && cached.expires > Date.now()) return cached.value;
    const value = this.#discover(cwd, scope !== undefined).catch((error: unknown) => {
      if (this.#catalogs.get(key)?.value === value) this.#catalogs.delete(key);
      throw error;
    });
    this.#catalogs.set(key, { expires: Date.now() + 60_000, revision, value });
    while (this.#catalogs.size > 16) {
      const oldest = this.#catalogs.keys().next().value;
      if (oldest !== undefined) this.#catalogs.delete(oldest);
    }
    return value;
  }

  async #discover(cwd: string, project: boolean): Promise<AgentEngineProfile> {
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
        env: this.configuration.environment(),
        abortController: controller,
        persistSession: false,
        settingSources:
          project && defaults.loadProjectSettings ? ["user", "project", "local"] : ["user"],
      },
    });
    const expired = Promise.withResolvers<never>();
    const timeout = setTimeout(() => {
      controller.abort();
      expired.reject(new Error("Claude capability discovery timed out"));
    }, 20_000);
    timeout.unref();
    try {
      const [models, commands, account] = await Promise.race([
        Promise.all([stream.supportedModels(), stream.supportedCommands(), stream.accountInfo()]),
        expired.promise,
      ]);
      const configured = credentials?.models ?? [];
      const sourceIds = configured.length
        ? configured.map((model) => model.id)
        : models.map((model) => model.value);
      // 两端只允许选择三档映射别名；不把具体版本、自定义默认值或扩展别名补回目录。
      const options = sourceIds.flatMap((id) => {
        const option = CLAUDE_MODEL_OPTIONS.find((option) => option.id === id);
        return option ? [option] : [];
      });
      const data = options.map(({ id, displayName }, index) => {
        const mapped = defaults.modelAliases?.[id];
        // 优先使用运行时报告的别名能力；自定义 ID 不根据名称猜测思考档位。
        const model =
          models.find((candidate) => candidate.value === id) ??
          (mapped ? models.find((candidate) => candidate.value === mapped) : undefined);
        return {
          id,
          // 不复用 SDK 或网关的展示文案，映射目标只用于匹配真实能力元数据。
          displayName,
          description: model?.description ?? "",
          isDefault: defaults.model === "default" ? index === 0 : id === defaults.model,
          defaultReasoningEffort: "",
          supportedReasoningEfforts: (model?.supportedEffortLevels ?? []).map((id) => ({
            id,
            description: id,
          })),
        };
      });
      const status = await this.configuration.status();
      const authenticated =
        [account.tokenSource, account.apiKeySource, account.email].some(
          (value) => typeof value === "string" && value.length > 0 && value !== "none",
        ) ||
        (account.apiProvider !== undefined && account.apiProvider !== "firstParty");
      const connection = authenticated ? { ...status, state: "connected" as const } : status;
      return {
        engine: "claude",
        authType: credentials?.authToken && !credentials.apiKey ? "authToken" : "apiKey",
        capabilities: CLAUDE_CAPABILITIES,
        connection,
        settings: await this.readSettings(),
        configuredModels: credentials?.models ?? [],
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
    // 清除用户原生 API 配置；SDK 仍可使用本机登录、环境变量或云认证。
    for (const provider of this.#providers.values()) provider.close();
    this.#providers.clear();
    this.#catalogs.clear();
    await this.configuration.clear();
    return { status: (await this.inspect()).connection };
  }

  release(projectId: string): void {
    this.#providers.get(projectId)?.close();
    this.#providers.delete(projectId);
  }
  close(): void {
    for (const controller of this.#commitRequests) controller.abort();
    this.#commitRequests.clear();
    for (const provider of this.#providers.values()) provider.close();
    this.#providers.clear();
    this.#catalogs.clear();
  }
}
