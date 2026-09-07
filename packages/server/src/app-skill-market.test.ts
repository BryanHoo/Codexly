import { describe, expect, it, vi } from "vitest";

import { createCodexlyServer } from "./app.js";
import { closeCallbacks } from "./app.test-support.js";
import { createProvider } from "./app-provider.test-support.js";
import { createServerOptions } from "./app-options.test-support.js";

describe("Skills market routes", () => {
  it("delivers installed, market, install, open, toggle, and MCP operations", async () => {
    const service = {
      getSkill: vi.fn(() =>
        Promise.resolve({
          canonicalUrl: "https://clawhub.ai/codex/skills/review",
          changelog: "Initial",
          displayName: "Review",
          downloads: 1,
          hasWarnings: false,
          id: "codex/review",
          latestVersion: "1.0.0",
          owner: "codex",
          readme: "---\nname: review\ndescription: Review.\n---\n",
          scanStatus: "clean",
          slug: "review",
          stars: 1,
          summary: "Review changes.",
          topics: [],
          updatedAt: 1,
          versionCount: 1,
          versions: [{ changelog: "Initial", createdAt: 1, version: "1.0.0" }],
        }),
      ),
      installSkill: vi.fn(() =>
        Promise.resolve({
          path: "/work/review",
          status: "installed",
          version: "1.0.0",
        }),
      ),
      getOfficialPlugin: vi.fn(() =>
        Promise.resolve({
          apps: [],
          authPolicy: "ON_USE" as const,
          availability: "AVAILABLE" as const,
          description: "GitHub integration",
          developerName: "OpenAI",
          disabledReason: null,
          displayName: "GitHub",
          enabled: false,
          hooks: [],
          id: "github@openai-curated",
          installPolicy: "AVAILABLE" as const,
          installed: false,
          localVersion: null,
          logoUrl: null,
          marketplaceName: "openai-curated",
          marketplacePath: null,
          mcpServers: [],
          name: "github",
          pluginName: "github",
          skills: [],
          version: "1.0.0",
          websiteUrl: null,
        }),
      ),
      installOfficialPlugin: vi.fn(() =>
        Promise.resolve({ appsNeedingAuth: [], authPolicy: "ON_USE" as const }),
      ),
      listConfiguredMcpServers: vi.fn(() =>
        Promise.resolve({ data: [{ enabled: true, name: "docs" }] }),
      ),
      listInstalledSkills: vi.fn(() => Promise.resolve({ data: [], nextCursor: null })),
      listOfficialPlugins: vi.fn(() => Promise.resolve({ data: [] })),
      listSkills: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
      openSkillDirectory: vi.fn(() => Promise.resolve({ status: "opened" })),
      setMcpServerEnabled: vi.fn(() => Promise.resolve({ enabled: false })),
      setSkillEnabled: vi.fn(() => Promise.resolve({ effectiveEnabled: false })),
      uninstallOfficialPlugin: vi.fn(() => Promise.resolve({})),
    };
    const app = await createCodexlyServer(
      createServerOptions(createProvider().provider, { skillMarketService: service }),
    );
    closeCallbacks.push(() => app.close());
    const headers = { "idempotency-key": "skill-action" };

    expect((await app.inject({ method: "GET", url: "/v1/skills/installed" })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/skills/market?query=review&sort=downloads" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/plugins/official?forceRefetch=true" }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/plugins/official/openai-curated/github",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          headers,
          method: "POST",
          payload: { installAttemptId: "attempt-1", marketplacePath: null },
          url: "/v1/plugins/official/openai-curated/github/install",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          headers,
          method: "POST",
          payload: { pluginId: "github@openai-curated" },
          url: "/v1/plugins/official/openai-curated/github/uninstall",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/skills/market/codex/review" })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          headers,
          method: "POST",
          payload: { path: "/skills/review/SKILL.md" },
          url: "/v1/skills/open",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          headers,
          method: "PUT",
          payload: { enabled: false, path: "/skills/review/SKILL.md" },
          url: "/v1/skills/enabled",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/mcp-servers/configured" })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          headers,
          method: "PUT",
          payload: { enabled: false },
          url: "/v1/mcp-servers/configured/docs/enabled",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          headers,
          method: "POST",
          payload: { projectId: "codexly", rootPath: "/workspace/Codexly", scope: "project" },
          url: "/v1/skills/market/codex/review/install",
        })
      ).statusCode,
    ).toBe(200);

    expect(service.listSkills).toHaveBeenCalledWith("review", null, "downloads");
    expect(service.setMcpServerEnabled).toHaveBeenCalledWith("docs", false);
    expect(service.installSkill).toHaveBeenCalledWith("codex", "review", {
      projectId: "codexly",
      rootPath: "/workspace/Codexly",
      scope: "project",
    });
    expect(service.listOfficialPlugins).toHaveBeenCalledWith(true);
    expect(service.getOfficialPlugin).toHaveBeenCalledWith("openai-curated", null, "github");
    expect(service.installOfficialPlugin).toHaveBeenCalledWith(
      "openai-curated",
      null,
      "github",
      "attempt-1",
    );
    expect(service.uninstallOfficialPlugin).toHaveBeenCalledWith("github@openai-curated");
  });
});
