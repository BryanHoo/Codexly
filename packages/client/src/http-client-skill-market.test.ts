import { describe, expect, it, vi } from "vitest";

import { CodexlyClient } from "./http-client.js";

describe("CodexlyClient skill market", () => {
  it("routes all Skills and MCP management operations", async () => {
    const calls: { body?: unknown; method: string; url: string }[] = [];
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? "GET";
      const requestBody = init?.body;
      calls.push({
        ...(typeof requestBody === "string" ? { body: JSON.parse(requestBody) as unknown } : {}),
        method,
        url,
      });
      let response: unknown = { data: [], nextCursor: null };
      if (url.includes("/plugins/official?")) response = { data: [] };
      else if (url.includes("/plugins/official/openai-curated/github")) {
        response = url.endsWith("/install")
          ? { appsNeedingAuth: [], authPolicy: "ON_USE", plugins: { data: [] } }
          : url.endsWith("/uninstall")
            ? { plugins: { data: [] } }
            : {
                apps: [],
                authPolicy: "ON_USE",
                availability: "AVAILABLE",
                description: "GitHub integration",
                developerName: "OpenAI",
                disabledReason: null,
                displayName: "GitHub",
                enabled: false,
                hooks: [],
                id: "github@openai-curated",
                installPolicy: "AVAILABLE",
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
              };
      } else if (url.endsWith("/skills/open")) response = { status: "opened" };
      else if (url.endsWith("/skills/enabled"))
        response = {
          effectiveEnabled: false,
          installedSkills: { data: [], nextCursor: null },
        };
      else if (url.endsWith("/enabled")) response = { enabled: false, servers: { data: [] } };
      else if (url.endsWith("/mcp-servers/configured")) response = { data: [] };
      return Promise.resolve(
        new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    });
    const client = new CodexlyClient({ baseUrl: "http://localhost", fetch });

    await client.listInstalledSkills();
    await client.openSkillDirectory("/skills/review/SKILL.md");
    await client.setSkillEnabled("/skills/review/SKILL.md", false);
    await client.listConfiguredMcpServers();
    await client.setMcpServerEnabled("docs/search", false);
    await client.listOfficialPlugins(true);
    await client.getOfficialPlugin("openai-curated", null, "github");
    await client.installOfficialPlugin("openai-curated", null, "github", "attempt-1");
    await client.uninstallOfficialPlugin("openai-curated", "github", "github@openai-curated");

    expect(calls.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: "GET", url: "http://localhost/v1/skills/installed" },
      { method: "POST", url: "http://localhost/v1/skills/open" },
      { method: "PUT", url: "http://localhost/v1/skills/enabled" },
      { method: "GET", url: "http://localhost/v1/mcp-servers/configured" },
      { method: "PUT", url: "http://localhost/v1/mcp-servers/configured/docs%2Fsearch/enabled" },
      { method: "GET", url: "http://localhost/v1/plugins/official?forceRefetch=true" },
      { method: "GET", url: "http://localhost/v1/plugins/official/openai-curated/github" },
      {
        method: "POST",
        url: "http://localhost/v1/plugins/official/openai-curated/github/install",
      },
      {
        method: "POST",
        url: "http://localhost/v1/plugins/official/openai-curated/github/uninstall",
      },
    ]);
  });
});
