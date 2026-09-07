import type {
  ConfiguredMcpServerPage,
  InstalledSkill,
  InstalledSkillPage,
  OfficialPluginApp,
  OfficialPluginDetail,
  OfficialPluginInstallResult,
  OfficialPluginPage,
  OfficialPluginSummary,
  OfficialPluginUninstallResult,
  Project,
  SetMcpServerEnabledResponse,
  SetSkillEnabledResponse,
} from "@codexly/protocol";

import {
  CodexProtocolMappingError,
  expectBoolean,
  expectRecord,
  expectString,
  mapCodexSkill,
} from "./codex-mapping-common.js";

type SkillMarketRpcClient = Readonly<{
  request(method: string, params?: unknown): Promise<unknown>;
}>;

const OFFICIAL_MARKETPLACES = new Set([
  "openai-curated",
  "openai-api-curated",
  "openai-curated-remote",
]);

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapOfficialPluginSummary(
  value: unknown,
  marketplaceName: string,
  marketplacePath: string | null,
): OfficialPluginSummary {
  const plugin = expectRecord(value, "plugin summary");
  const name = expectString(plugin["name"], "plugin summary name");
  const view =
    plugin["interface"] === undefined
      ? undefined
      : expectRecord(plugin["interface"], "plugin summary interface");
  const authPolicy = expectString(plugin["authPolicy"], "plugin summary authPolicy");
  const installPolicy = expectString(plugin["installPolicy"], "plugin summary installPolicy");
  const availability = plugin["availability"] ?? "AVAILABLE";
  if (authPolicy !== "ON_INSTALL" && authPolicy !== "ON_USE") {
    throw new CodexProtocolMappingError("plugin summary authPolicy is invalid");
  }
  if (
    installPolicy !== "NOT_AVAILABLE" &&
    installPolicy !== "AVAILABLE" &&
    installPolicy !== "INSTALLED_BY_DEFAULT"
  ) {
    throw new CodexProtocolMappingError("plugin summary installPolicy is invalid");
  }
  if (availability !== "AVAILABLE" && availability !== "DISABLED_BY_ADMIN") {
    throw new CodexProtocolMappingError("plugin summary availability is invalid");
  }
  return {
    authPolicy,
    availability,
    description: typeof view?.["shortDescription"] === "string" ? view["shortDescription"] : "",
    developerName: nullableString(view?.["developerName"]),
    disabledReason: nullableString(plugin["disabledReason"]),
    displayName: typeof view?.["displayName"] === "string" ? view["displayName"] : name,
    enabled: typeof plugin["enabled"] === "boolean" ? plugin["enabled"] : false,
    id: expectString(plugin["id"], "plugin summary id"),
    installPolicy,
    installed: typeof plugin["installed"] === "boolean" ? plugin["installed"] : false,
    localVersion: nullableString(plugin["localVersion"]),
    logoUrl: nullableString(view?.["logoUrl"]),
    marketplaceName,
    marketplacePath,
    name,
    pluginName: typeof plugin["remotePluginId"] === "string" ? plugin["remotePluginId"] : name,
    version: nullableString(plugin["version"]),
  };
}

function mapOfficialPluginApps(value: unknown): OfficialPluginApp[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const app = expectRecord(item, "plugin app");
    return {
      description: typeof app["description"] === "string" ? app["description"] : "",
      id: expectString(app["id"], "plugin app id"),
      installUrl: nullableString(app["installUrl"]),
      name: expectString(app["name"], "plugin app name"),
    };
  });
}

function remotePluginParams(
  marketplaceName: string,
  marketplacePath: string | null,
  pluginName: string,
): Readonly<Record<string, unknown>> {
  return {
    marketplacePath,
    pluginName,
    remoteMarketplaceName: marketplacePath === null ? marketplaceName : null,
  };
}

export async function listCodexOfficialPlugins(
  client: SkillMarketRpcClient,
  projects: readonly Project[],
  forceRefetch: boolean,
): Promise<OfficialPluginPage> {
  const response = expectRecord(
    await client.request("plugin/list", {
      cwds: projects.flatMap((project) => project.roots.map((root) => root.path)),
      forceRefetch,
      marketplaceKinds: null,
    }),
    "plugin/list response",
  );
  if (!Array.isArray(response["marketplaces"])) {
    throw new CodexProtocolMappingError("plugin/list marketplaces must be an array");
  }
  const data: OfficialPluginSummary[] = [];
  for (const value of response["marketplaces"]) {
    const marketplace = expectRecord(value, "plugin marketplace");
    const name = expectString(marketplace["name"], "plugin marketplace name");
    if (!OFFICIAL_MARKETPLACES.has(name)) continue;
    if (!Array.isArray(marketplace["plugins"])) {
      throw new CodexProtocolMappingError("plugin marketplace plugins must be an array");
    }
    const path = nullableString(marketplace["path"]);
    for (const plugin of marketplace["plugins"]) {
      data.push(mapOfficialPluginSummary(plugin, name, path));
    }
  }
  return { data };
}

export async function getCodexOfficialPlugin(
  client: SkillMarketRpcClient,
  marketplaceName: string,
  marketplacePath: string | null,
  pluginName: string,
): Promise<OfficialPluginDetail> {
  const response = expectRecord(
    await client.request(
      "plugin/read",
      remotePluginParams(marketplaceName, marketplacePath, pluginName),
    ),
    "plugin/read response",
  );
  const plugin = expectRecord(response["plugin"], "plugin/read plugin");
  const summaryValue = expectRecord(plugin["summary"], "plugin/read summary");
  const summary = mapOfficialPluginSummary(
    summaryValue,
    expectString(plugin["marketplaceName"], "plugin/read marketplaceName"),
    nullableString(plugin["marketplacePath"]),
  );
  const skills = Array.isArray(plugin["skills"])
    ? plugin["skills"].map((value) => {
        const skill = expectRecord(value, "plugin skill");
        return {
          description:
            typeof skill["shortDescription"] === "string"
              ? skill["shortDescription"]
              : typeof skill["description"] === "string"
                ? skill["description"]
                : "",
          name: expectString(skill["name"], "plugin skill name"),
        };
      })
    : [];
  const mcpServers = Array.isArray(plugin["mcpServers"])
    ? plugin["mcpServers"].map((value) => expectString(value, "plugin MCP server"))
    : [];
  const hooks = Array.isArray(plugin["hooks"])
    ? plugin["hooks"].map((value) =>
        expectString(expectRecord(value, "plugin hook")["key"], "plugin hook key"),
      )
    : [];
  const view =
    summaryValue["interface"] === undefined
      ? undefined
      : expectRecord(summaryValue["interface"], "plugin summary interface");
  return {
    ...summary,
    apps: mapOfficialPluginApps(plugin["apps"]),
    description:
      typeof plugin["description"] === "string" ? plugin["description"] : summary.description,
    hooks,
    mcpServers,
    skills,
    websiteUrl: nullableString(view?.["websiteUrl"]),
  };
}

export async function installCodexOfficialPlugin(
  client: SkillMarketRpcClient,
  marketplaceName: string,
  marketplacePath: string | null,
  pluginName: string,
  installAttemptId: string,
): Promise<OfficialPluginInstallResult> {
  const response = expectRecord(
    await client.request("plugin/install", {
      installAttemptId,
      ...remotePluginParams(marketplaceName, marketplacePath, pluginName),
    }),
    "plugin/install response",
  );
  const authPolicy = expectString(response["authPolicy"], "plugin/install authPolicy");
  if (authPolicy !== "ON_INSTALL" && authPolicy !== "ON_USE") {
    throw new CodexProtocolMappingError("plugin/install authPolicy is invalid");
  }
  return { appsNeedingAuth: mapOfficialPluginApps(response["appsNeedingAuth"]), authPolicy };
}

export async function uninstallCodexOfficialPlugin(
  client: SkillMarketRpcClient,
  pluginId: string,
): Promise<OfficialPluginUninstallResult> {
  await client.request("plugin/uninstall", { pluginId });
  return {};
}

export async function listCodexInstalledSkills(
  client: SkillMarketRpcClient,
  projects: readonly Project[],
  forceReload: boolean,
): Promise<InstalledSkillPage> {
  const roots = projects.flatMap((project) =>
    project.roots.map((root) => ({ path: root.path, project })),
  );
  const rootsByPath = new Map(roots.map((root) => [root.path, root]));
  const response = expectRecord(
    await client.request("skills/list", {
      cwds: roots.map((root) => root.path),
      forceReload,
    }),
    "skills/list response",
  );
  if (!Array.isArray(response["data"])) {
    throw new CodexProtocolMappingError("skills/list data must be an array");
  }

  const seenPaths = new Set<string>();
  const data: InstalledSkill[] = [];
  for (const value of response["data"]) {
    const entry = expectRecord(value, "skills/list entry");
    const cwd = expectString(entry["cwd"], "skills/list cwd");
    if (!Array.isArray(entry["skills"])) {
      throw new CodexProtocolMappingError("skills/list skills must be an array");
    }
    for (const rawSkill of entry["skills"]) {
      const skill = mapCodexSkill(rawSkill);
      // Codex 按 cwd 重复返回全局 Skill，绝对路径去重可减少传输和渲染负担。
      if (seenPaths.has(skill.path)) continue;
      seenPaths.add(skill.path);
      const root = skill.scope === "repo" ? rootsByPath.get(cwd) : undefined;
      data.push({
        ...skill,
        ...(root === undefined
          ? {}
          : {
              projectId: root.project.id,
              projectName: root.project.name,
              rootPath: root.path,
            }),
        source: "local",
      });
    }
  }
  return { data, nextCursor: null };
}

export async function setCodexSkillEnabled(
  client: SkillMarketRpcClient,
  path: string,
  enabled: boolean,
): Promise<SetSkillEnabledResponse> {
  const response = expectRecord(
    await client.request("skills/config/write", { enabled, name: null, path }),
    "skills/config/write response",
  );
  return {
    effectiveEnabled: expectBoolean(
      response["effectiveEnabled"],
      "skills/config/write effectiveEnabled",
    ),
  };
}

export async function listCodexConfiguredMcpServers(
  client: SkillMarketRpcClient,
): Promise<ConfiguredMcpServerPage> {
  const response = expectRecord(
    await client.request("config/read", { includeLayers: false }),
    "config/read response",
  );
  const config = expectRecord(response["config"], "config/read config");
  const rawServers = config["mcp_servers"];
  if (rawServers === undefined) return { data: [] };
  const servers = expectRecord(rawServers, "config/read mcp_servers");
  return {
    data: Object.entries(servers)
      .map(([name, value]) => {
        const server = expectRecord(value, `config/read mcp_servers.${name}`);
        const configuredEnabled = server["enabled"];
        if (configuredEnabled !== undefined && typeof configuredEnabled !== "boolean") {
          throw new CodexProtocolMappingError(`config/read mcp_servers.${name}.enabled is invalid`);
        }
        return { enabled: configuredEnabled ?? true, name };
      })
      .toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

function quoteConfigKeySegment(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export async function setCodexMcpServerEnabled(
  client: SkillMarketRpcClient,
  name: string,
  enabled: boolean,
): Promise<SetMcpServerEnabledResponse> {
  await client.request("config/value/write", {
    expectedVersion: null,
    filePath: null,
    keyPath: `mcp_servers.${quoteConfigKeySegment(name)}.enabled`,
    mergeStrategy: "replace",
    value: enabled,
  });
  // 写入后立即通知运行时重载，避免界面状态与实际进程配置不一致。
  await client.request("config/mcpServer/reload");
  return { enabled };
}
