import type {
  ConfiguredMcpServerPage,
  InstalledSkill,
  InstalledSkillPage,
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
