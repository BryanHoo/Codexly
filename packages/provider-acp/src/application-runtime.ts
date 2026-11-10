import {
  taskTitlePrompt,
  parseTaskTitle,
  type AgentRuntimeProvider,
  type AgentRuntimeDefaultSettings,
  type LocalCatalogStore,
} from "@codexly/core";
import type { AgentGlobalSettings, AgentEngine } from "@codexly/protocol";
import { AcpRuntime, type AcpAgentLauncher } from "./runtime.js";
import { acpCapabilities } from "./provider-discovery.js";
import { acpModels } from "./session-options.js";
import { migrateAcpSettings } from "./migration.js";

type Preferences = Pick<AgentGlobalSettings, "defaultAgent" | "defaultModel">;
const unsupported = (operation: string): Promise<never> =>
  Promise.reject(new Error(`ACP 不提供旧专用接口 ${operation}，请使用 ACP 服务`));

/** 交付层只装配此端口；所有执行、模型和配置交互均通过共享 ACP Runtime。 */
export class AcpApplicationRuntime extends AcpRuntime implements AgentRuntimeProvider {
  constructor(
    directory: string,
    store: LocalCatalogStore,
    readonly readPreferences: () => Promise<Preferences | undefined>,
    launch?: AcpAgentLauncher,
  ) {
    super(directory, store, launch);
  }
  get acpAgents() {
    return this.agents;
  }
  getCapabilities() {
    return acpCapabilities("codex");
  }
  async listModels(engine: AgentEngine = "codex") {
    return acpModels((await this.agents[engine].readDefaults()).configOptions);
  }
  async readDefaultSettings(): Promise<AgentRuntimeDefaultSettings> {
    const { configOptions } = await this.agents.codex.readDefaults();
    const model = configOptions.find(
      (option) => option.category === "model" && option.type === "select",
    );
    const effort = configOptions.find(
      (option) => option.category === "thought_level" && option.type === "select",
    );
    return {
      ...(model?.type === "select" ? { model: model.currentValue } : {}),
      ...(effort?.type === "select" ? { reasoningEffort: effort.currentValue } : {}),
    };
  }
  async updateDefaultSettings(settings: AgentRuntimeDefaultSettings): Promise<void> {
    const current = await this.agents.codex.readDefaults();
    const migration = migrateAcpSettings(settings, current.configOptions);
    // 不将旧沙盒或授权枚举猜测为 ACP mode；有未映射字段时保留原值并明确拒绝。
    if (migration.unmapped.length)
      throw new Error("旧默认设置无法精确映射为 ACP 配置，请使用 ACP 设置");
    await this.agents.codex.updateDefaults({ ...current.defaults, ...migration.values });
  }
  async readGenerationDefaults(stored: Preferences | undefined): Promise<Required<Preferences>> {
    const preferences = stored ?? (await this.readPreferences());
    const defaultAgent = preferences?.defaultAgent ?? "codex";
    if (preferences?.defaultModel) return { defaultAgent, defaultModel: preferences.defaultModel };
    // 缺省模型只取所选 agent 的实际当前值；不探测另一个引擎或维护模型别名。
    const page = await this.listModels(defaultAgent);
    const model = page.data.find((item) => item.isDefault);
    if (!model) throw new Error("ACP agent 没有公布默认模型");
    return { defaultAgent, defaultModel: model.id };
  }
  async generateTaskTitle(
    cwd: string,
    text: string,
    model: string,
    signal: AbortSignal,
    instructions?: string,
  ): Promise<string> {
    signal.throwIfAborted();
    const preferences = await this.readGenerationDefaults(await this.readPreferences());
    const prompt = `${taskTitlePrompt(text, instructions)}\n仅返回 JSON 对象，格式为 {"title":"标题"}。`;
    return parseTaskTitle(
      await this.generateText(
        preferences.defaultAgent,
        cwd,
        prompt,
        model || preferences.defaultModel,
        signal,
      ),
    );
  }

  // 这些旧 API 没有通用 ACP 等价物，交付层必须迁移调用；禁止空列表或假账号伪装成功。
  readonly readProviderConnection: AgentRuntimeProvider["readProviderConnection"] = () =>
    unsupported("readProviderConnection");
  readonly cancelProviderLogin: AgentRuntimeProvider["cancelProviderLogin"] = () =>
    unsupported("cancelProviderLogin");
  readonly configureCustomProvider: AgentRuntimeProvider["configureCustomProvider"] = () =>
    unsupported("configureCustomProvider");
  readonly startOfficialProviderLogin: AgentRuntimeProvider["startOfficialProviderLogin"] = () =>
    unsupported("startOfficialProviderLogin");
  readonly logoutProvider: AgentRuntimeProvider["logoutProvider"] = () =>
    unsupported("logoutProvider");
  readonly listConfiguredMcpServers: AgentRuntimeProvider["listConfiguredMcpServers"] = () =>
    unsupported("listConfiguredMcpServers");
  readonly listInstalledSkills: AgentRuntimeProvider["listInstalledSkills"] = () =>
    unsupported("listInstalledSkills");
  readonly setMcpServerEnabled: AgentRuntimeProvider["setMcpServerEnabled"] = () =>
    unsupported("setMcpServerEnabled");
  readonly setSkillEnabled: AgentRuntimeProvider["setSkillEnabled"] = () =>
    unsupported("setSkillEnabled");
  readonly reconcileOfficialPlugins: AgentRuntimeProvider["reconcileOfficialPlugins"] = () =>
    unsupported("reconcileOfficialPlugins");
  readonly listOfficialPlugins: AgentRuntimeProvider["listOfficialPlugins"] = () =>
    unsupported("listOfficialPlugins");
  readonly getOfficialPlugin: AgentRuntimeProvider["getOfficialPlugin"] = () =>
    unsupported("getOfficialPlugin");
  readonly installOfficialPlugin: AgentRuntimeProvider["installOfficialPlugin"] = () =>
    unsupported("installOfficialPlugin");
  readonly uninstallOfficialPlugin: AgentRuntimeProvider["uninstallOfficialPlugin"] = () =>
    unsupported("uninstallOfficialPlugin");
}
