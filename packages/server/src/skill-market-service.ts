import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import type { AgentRuntimeProvider, ProjectRepository } from "@codexly/core";
import type {
  ClawhubSkillDetail,
  ClawhubSkillPage,
  ConfiguredMcpServerPage,
  InstalledSkill,
  InstalledSkillPage,
  OpenSkillDirectoryResponse,
  SetMcpServerEnabledResponse,
  SetSkillEnabledResponse,
  SkillInstallResult,
  SkillInstallScope,
} from "@codexly/protocol";
import pLimit from "p-limit";

import type { ProjectOpenService } from "./project-open.js";
import type { ClawhubClient } from "./skill-market-client.js";
import { SkillMarketError } from "./skill-market-error.js";
import { installClawhubArchive } from "./skill-market-installer.js";

const ORIGIN_LIMIT = 64 * 1024;

export type InstallSkillInput = Readonly<{
  projectId?: string;
  rootPath?: string;
  scope: SkillInstallScope;
}>;

export interface SkillMarketService {
  getSkill(owner: string, slug: string): Promise<ClawhubSkillDetail>;
  installSkill(owner: string, slug: string, input: InstallSkillInput): Promise<SkillInstallResult>;
  listConfiguredMcpServers(): Promise<ConfiguredMcpServerPage>;
  listInstalledSkills(forceReload: boolean): Promise<InstalledSkillPage>;
  listSkills(query: string, cursor: string | null, sort: string): Promise<ClawhubSkillPage>;
  openSkillDirectory(path: string): Promise<OpenSkillDirectoryResponse>;
  setMcpServerEnabled(name: string, enabled: boolean): Promise<SetMcpServerEnabledResponse>;
  setSkillEnabled(path: string, enabled: boolean): Promise<SetSkillEnabledResponse>;
}

type CreateSkillMarketServiceOptions = Readonly<{
  catalog: ClawhubClient;
  homeDirectory?: string;
  projectOpenService: ProjectOpenService;
  projectRepository: ProjectRepository;
  provider: AgentRuntimeProvider;
}>;

type MarketplaceOrigin = Readonly<{
  installedVersion: string;
  owner: string;
  slug: string;
}>;

async function readMarketplaceOrigin(path: string): Promise<MarketplaceOrigin | undefined> {
  try {
    const originPath = join(dirname(path), ".clawhub/origin.json");
    if ((await stat(originPath)).size > ORIGIN_LIMIT) return undefined;
    const value = JSON.parse(await readFile(originPath, "utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const origin = value as Record<string, unknown>;
    return typeof origin["installedVersion"] === "string" &&
      typeof origin["ownerHandle"] === "string" &&
      typeof origin["slug"] === "string"
      ? {
          installedVersion: origin["installedVersion"],
          owner: origin["ownerHandle"],
          slug: origin["slug"],
        }
      : undefined;
  } catch {
    return undefined;
  }
}

async function enrichInstalledSkills(data: readonly InstalledSkill[]): Promise<InstalledSkill[]> {
  const limit = pLimit(32);
  return Promise.all(
    data.map((skill) =>
      limit(async () => {
        const marketplace = await readMarketplaceOrigin(skill.path);
        return marketplace === undefined
          ? skill
          : { ...skill, marketplace, source: "clawhub" as const };
      }),
    ),
  );
}

function filesystemError(message: string): SkillMarketError {
  return new SkillMarketError("SKILL_MARKET_FILESYSTEM", message);
}

export function createSkillMarketService(
  options: CreateSkillMarketServiceOptions,
): SkillMarketService {
  const homeDirectory = options.homeDirectory ?? homedir();
  const discover = async (forceReload: boolean) => {
    const projects = await options.projectRepository.list();
    const page = await options.provider.listInstalledSkills(projects, forceReload);
    return { page, projects };
  };
  return {
    getSkill: (owner, slug) => options.catalog.getSkill(owner, slug),
    async installSkill(owner, slug, input) {
      const detail = await options.catalog.getSkill(owner, slug);
      if (detail.scanStatus !== "clean") {
        throw new SkillMarketError("SKILL_MARKET_UNSAFE", "Skill package failed the security scan");
      }
      const projects = await options.projectRepository.list();
      let skillsRoot: string;
      if (input.scope === "user") {
        skillsRoot = join(homeDirectory, ".agents/skills");
      } else {
        const project = projects.find((item) => item.id === input.projectId);
        const root = project?.roots.find((item) => item.path === input.rootPath);
        if (root === undefined) throw filesystemError("Skill project root is invalid");
        skillsRoot = join(root.path, ".agents/skills");
      }
      const archive = await options.catalog.downloadArchive(owner, slug, detail.latestVersion);
      const result = await installClawhubArchive(
        archive,
        skillsRoot,
        owner,
        slug,
        detail.latestVersion,
      );
      // 安装绕过 App Server 文件写入，强制刷新其发现缓存后再返回成功。
      await options.provider.listInstalledSkills(projects, true);
      return result;
    },
    listConfiguredMcpServers: () => options.provider.listConfiguredMcpServers(),
    async listInstalledSkills(forceReload) {
      const { page } = await discover(forceReload);
      return { ...page, data: await enrichInstalledSkills(page.data) };
    },
    listSkills: (query, cursor, sort) => options.catalog.listSkills(query, cursor, sort),
    async openSkillDirectory(path) {
      const { page } = await discover(false);
      if (!page.data.some((skill) => skill.path === path)) {
        throw filesystemError("Skill path was not discovered");
      }
      let target: string;
      try {
        target = await realpath(path);
      } catch {
        throw filesystemError("Skill path is unavailable");
      }
      if (basename(target) !== "SKILL.md") throw filesystemError("Skill path is invalid");
      const capabilities = await options.projectOpenService.getCapabilities();
      const fileManager = capabilities.apps.find((app) => app.kind === "file-manager");
      if (fileManager === undefined) throw filesystemError("File manager is unavailable");
      await options.projectOpenService.open(dirname(target), fileManager.id, target);
      return { status: "opened" };
    },
    setMcpServerEnabled: (name, enabled) => options.provider.setMcpServerEnabled(name, enabled),
    setSkillEnabled: (path, enabled) => options.provider.setSkillEnabled(path, enabled),
  };
}
