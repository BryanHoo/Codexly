import type { Project } from "@codexly/protocol";
import { describe, expect, it } from "vitest";

import { CodexRuntimeProvider } from "./runtime-provider.js";
import { FakeRpcClient } from "./agent-provider.test-support.js";

const projects: readonly Project[] = [
  {
    createdAt: "2026-09-04T00:00:00.000Z",
    id: "project-a",
    name: "Project A",
    roots: [{ id: "root-a", path: "/work" }],
  },
  {
    createdAt: "2026-09-04T00:00:00.000Z",
    id: "project-b",
    name: "Project B",
    roots: [{ id: "root-b", path: "/other" }],
  },
];

describe("CodexRuntimeProvider skill market", () => {
  it("lists installed skills once and preserves their project ownership", async () => {
    const client = new FakeRpcClient([
      {
        data: [
          {
            cwd: "/work",
            errors: [],
            skills: [
              {
                description: "Review code",
                enabled: true,
                interface: { displayName: "Code Review", shortDescription: "Review changes" },
                name: "review",
                path: "/work/.agents/skills/review/SKILL.md",
                pluginId: null,
                scope: "repo",
              },
              {
                description: "Global helper",
                enabled: true,
                name: "helper",
                path: "/home/user/.agents/skills/helper/SKILL.md",
                pluginId: null,
                scope: "user",
              },
            ],
          },
          {
            cwd: "/other",
            errors: [],
            skills: [
              {
                description: "Global helper",
                enabled: true,
                name: "helper",
                path: "/home/user/.agents/skills/helper/SKILL.md",
                pluginId: null,
                scope: "user",
              },
            ],
          },
        ],
      },
    ]);
    const runtime = new CodexRuntimeProvider(client);

    const response = await runtime.listInstalledSkills(projects, false);
    expect(response.data[0]?.id).toMatch(/^skill_/);
    expect(response.data[1]?.id).toMatch(/^skill_/);
    expect(response).toEqual({
      data: [
        {
          description: "Review changes",
          displayName: "Code Review",
          enabled: true,
          id: response.data[0]?.id,
          name: "review",
          path: "/work/.agents/skills/review/SKILL.md",
          projectId: "project-a",
          projectName: "Project A",
          rootPath: "/work",
          scope: "repo",
          source: "local",
        },
        {
          description: "Global helper",
          displayName: "helper",
          enabled: true,
          id: response.data[1]?.id,
          name: "helper",
          path: "/home/user/.agents/skills/helper/SKILL.md",
          scope: "user",
          source: "local",
        },
      ],
      nextCursor: null,
    });
    expect(client.calls).toEqual([
      { method: "skills/list", params: { cwds: ["/work", "/other"], forceReload: false } },
    ]);
  });

  it("toggles a skill through the official path selector", async () => {
    const client = new FakeRpcClient([{ effectiveEnabled: false }]);
    const runtime = new CodexRuntimeProvider(client);

    await expect(runtime.setSkillEnabled("/skills/review/SKILL.md", false)).resolves.toEqual({
      effectiveEnabled: false,
    });
    expect(client.calls).toEqual([
      {
        method: "skills/config/write",
        params: { enabled: false, name: null, path: "/skills/review/SKILL.md" },
      },
    ]);
  });

  it("lists MCP configuration without exposing command or URL values", async () => {
    const client = new FakeRpcClient([
      {
        config: {
          mcp_servers: {
            docs: { command: "secret-command" },
            linear: { enabled: false, url: "https://example.test" },
          },
        },
        origins: {},
      },
    ]);
    const runtime = new CodexRuntimeProvider(client);

    await expect(runtime.listConfiguredMcpServers()).resolves.toEqual({
      data: [
        { enabled: true, name: "docs" },
        { enabled: false, name: "linear" },
      ],
    });
    expect(client.calls).toEqual([{ method: "config/read", params: { includeLayers: false } }]);
  });

  it("quotes an MCP name before updating and reloading runtime configuration", async () => {
    const client = new FakeRpcClient([
      { filePath: "/home/user/.codex/config.toml", status: "ok", version: "2" },
      {},
    ]);
    const runtime = new CodexRuntimeProvider(client);

    await expect(runtime.setMcpServerEnabled('docs."search"', false)).resolves.toEqual({
      enabled: false,
    });
    expect(client.calls).toEqual([
      {
        method: "config/value/write",
        params: {
          expectedVersion: null,
          filePath: null,
          keyPath: 'mcp_servers."docs.\\"search\\"".enabled',
          mergeStrategy: "replace",
          value: false,
        },
      },
      { method: "config/mcpServer/reload", params: undefined },
    ]);
  });
});
