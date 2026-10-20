import type { PluginReconcileResult } from "@codexly/protocol";
import { basename, dirname } from "node:path";
import { realpath } from "node:fs/promises";
import type { AgentRuntimeProvider, ProjectRepository } from "@codexly/core";
import type {
  ConfiguredMcpServerPage,
  InstalledSkillPage,
  OpenSkillDirectoryResponse,
  OfficialPluginDetail,
  OfficialPluginInstallResult,
  OfficialPluginPage,
  OfficialPluginUninstallResult,
  SetMcpServerEnabledResult,
  SetSkillEnabledResult,
} from "@codexly/protocol";

import type { ProjectOpenService } from "./project-open.js";

export interface SkillMarketService {
  reconcileOfficialPlugins(): Promise<PluginReconcileResult>;
  getOfficialPlugin(
    marketplaceName: string,
    marketplacePath: string | null,
    pluginName: string,
  ): Promise<OfficialPluginDetail>;
  installOfficialPlugin(
    marketplaceName: string,
    marketplacePath: string | null,
    pluginName: string,
    installAttemptId: string,
  ): Promise<OfficialPluginInstallResult>;
  listConfiguredMcpServers(): Promise<ConfiguredMcpServerPage>;
  listInstalledSkills(forceReload: boolean): Promise<InstalledSkillPage>;
  listOfficialPlugins(forceRefetch: boolean): Promise<OfficialPluginPage>;
  openSkillDirectory(path: string): Promise<OpenSkillDirectoryResponse>;
  setMcpServerEnabled(name: string, enabled: boolean): Promise<SetMcpServerEnabledResult>;
  setSkillEnabled(path: string, enabled: boolean): Promise<SetSkillEnabledResult>;
  uninstallOfficialPlugin(pluginId: string): Promise<OfficialPluginUninstallResult>;
}

type CreateSkillMarketServiceOptions = Readonly<{
  projectOpenService: ProjectOpenService;
  projectRepository: ProjectRepository;
  provider: AgentRuntimeProvider;
}>;

export class SkillDirectoryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SkillDirectoryError";
  }
}

export function createSkillMarketService(
  options: CreateSkillMarketServiceOptions,
): SkillMarketService {
  const discover = async (forceReload: boolean) => {
    const projects = await options.projectRepository.list();
    const page = await options.provider.listInstalledSkills(projects, forceReload);
    return { page, projects };
  };
  return {
    getOfficialPlugin: (marketplaceName, marketplacePath, pluginName) =>
      options.provider.getOfficialPlugin(marketplaceName, marketplacePath, pluginName),
    installOfficialPlugin: (marketplaceName, marketplacePath, pluginName, installAttemptId) =>
      options.provider.installOfficialPlugin(
        marketplaceName,
        marketplacePath,
        pluginName,
        installAttemptId,
      ),
    listConfiguredMcpServers: () => options.provider.listConfiguredMcpServers(),
    async listInstalledSkills(forceReload) {
      const { page } = await discover(forceReload);
      // 直接使用运行时发现结果，避免为每个 Skill 额外读取市场元数据。
      return page;
    },
    reconcileOfficialPlugins: () => options.provider.reconcileOfficialPlugins(),
    async listOfficialPlugins(forceRefetch) {
      const projects = await options.projectRepository.list();
      return options.provider.listOfficialPlugins(projects, forceRefetch);
    },
    async openSkillDirectory(path) {
      const { page } = await discover(false);
      if (!page.data.some((skill) => skill.path === path)) {
        throw new SkillDirectoryError("Skill path was not discovered");
      }
      let target: string;
      try {
        target = await realpath(path);
      } catch {
        throw new SkillDirectoryError("Skill path is unavailable");
      }
      if (basename(target) !== "SKILL.md") throw new SkillDirectoryError("Skill path is invalid");
      const capabilities = await options.projectOpenService.getCapabilities();
      const fileManager = capabilities.apps.find((app) => app.kind === "file-manager");
      if (fileManager === undefined) throw new SkillDirectoryError("File manager is unavailable");
      await options.projectOpenService.open(dirname(target), fileManager.id, target);
      return { status: "opened" };
    },
    setMcpServerEnabled: (name, enabled) => options.provider.setMcpServerEnabled(name, enabled),
    setSkillEnabled: (path, enabled) => options.provider.setSkillEnabled(path, enabled),
    uninstallOfficialPlugin: (pluginId) => options.provider.uninstallOfficialPlugin(pluginId),
  };
}
