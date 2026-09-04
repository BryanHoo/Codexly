import { describe, expect, it, vi } from "vitest";

import { CodexlyClient } from "./http-client.js";

const summary = {
  canonicalUrl: "https://clawhub.ai/codex/skills/review",
  displayName: "Review",
  downloads: 1,
  id: "codex/review",
  latestVersion: "1.0.0",
  owner: "codex",
  slug: "review",
  stars: 1,
  summary: "Review changes.",
  topics: [],
  updatedAt: 1,
  versionCount: 1,
};

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
      if (url.includes("/market?")) response = { items: [summary], nextCursor: null };
      else if (url.endsWith("/market/codex/review"))
        response = {
          ...summary,
          changelog: "Initial",
          hasWarnings: false,
          readme: "---\nname: review\ndescription: Review.\n---\n",
          scanStatus: "clean",
          versions: [],
        };
      else if (url.endsWith("/install"))
        response = { path: "/work/review", status: "installed", version: "1.0.0" };
      else if (url.endsWith("/skills/open")) response = { status: "opened" };
      else if (url.endsWith("/skills/enabled")) response = { effectiveEnabled: false };
      else if (url.endsWith("/enabled")) response = { enabled: false };
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
    await client.listClawhubSkills("review", null, "downloads");
    await client.getClawhubSkill("codex", "review");
    await client.installClawhubSkill("codex", "review", "project", "project-a", "/work");
    await client.openSkillDirectory("/skills/review/SKILL.md");
    await client.setSkillEnabled("/skills/review/SKILL.md", false);
    await client.listConfiguredMcpServers();
    await client.setMcpServerEnabled("docs/search", false);

    expect(calls.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: "GET", url: "http://localhost/v1/skills/installed" },
      { method: "GET", url: "http://localhost/v1/skills/market?query=review&sort=downloads" },
      { method: "GET", url: "http://localhost/v1/skills/market/codex/review" },
      { method: "POST", url: "http://localhost/v1/skills/market/codex/review/install" },
      { method: "POST", url: "http://localhost/v1/skills/open" },
      { method: "PUT", url: "http://localhost/v1/skills/enabled" },
      { method: "GET", url: "http://localhost/v1/mcp-servers/configured" },
      { method: "PUT", url: "http://localhost/v1/mcp-servers/configured/docs%2Fsearch/enabled" },
    ]);
  });
});
