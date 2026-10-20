import { describe, expect, it, vi } from "vitest";

import { createCodexlyServer } from "./app.js";
import { closeCallbacks } from "./app.test-support.js";
import { createProvider } from "./app-provider.test-support.js";
import { createServerOptions } from "./app-options.test-support.js";

describe("Skills market routes", () => {
  it.each([
    { method: "GET" as const, url: "/v1/skills/market?query=review&sort=downloads" },
    { method: "GET" as const, url: "/v1/skills/market/codex/review" },
    { method: "POST" as const, url: "/v1/skills/market/codex/review/install" },
  ])("不再提供第三方市场接口：$method $url", async ({ method, url }) => {
    const app = await createCodexlyServer(createServerOptions(createProvider().provider));
    closeCallbacks.push(() => app.close());
    const response = await app.inject({
      method,
      url,
      ...(method === "POST"
        ? {
            headers: { "idempotency-key": "removed-market" },
            payload: { scope: "user" },
          }
        : {}),
    });
    expect(response.statusCode).toBe(404);
  });
  it("delivers installed Skills, official plugins, open, toggle, and MCP operations", async () => {
    const service = {
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
    const pluginInstall = await app.inject({
      headers,
      method: "POST",
      payload: { installAttemptId: "attempt-1", marketplacePath: null },
      url: "/v1/plugins/official/openai-curated/github/install",
    });
    expect(pluginInstall.statusCode).toBe(200);
    expect(pluginInstall.json()).toMatchObject({
      appsNeedingAuth: [],
      plugins: { data: [] },
    });
    const pluginUninstall = await app.inject({
      headers,
      method: "POST",
      payload: { pluginId: "github@openai-curated" },
      url: "/v1/plugins/official/openai-curated/github/uninstall",
    });
    expect(pluginUninstall.statusCode).toBe(200);
    expect(pluginUninstall.json()).toEqual({ plugins: { data: [] } });
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
    const skillToggle = await app.inject({
      headers,
      method: "PUT",
      payload: { enabled: false, path: "/skills/review/SKILL.md" },
      url: "/v1/skills/enabled",
    });
    expect(skillToggle.statusCode).toBe(200);
    expect(skillToggle.json()).toMatchObject({
      effectiveEnabled: false,
      installedSkills: { data: [], nextCursor: null },
    });
    expect(
      (await app.inject({ method: "GET", url: "/v1/mcp-servers/configured" })).statusCode,
    ).toBe(200);
    const mcpToggle = await app.inject({
      headers,
      method: "PUT",
      payload: { enabled: false },
      url: "/v1/mcp-servers/configured/docs/enabled",
    });
    expect(mcpToggle.statusCode).toBe(200);
    expect(mcpToggle.json()).toMatchObject({
      enabled: false,
      servers: { data: [{ enabled: true, name: "docs" }] },
    });
    expect(service.setMcpServerEnabled).toHaveBeenCalledWith("docs", false);
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
