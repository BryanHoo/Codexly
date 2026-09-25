import { describe, expect, it, vi } from "vitest";

import { TauriCatalogClient } from "./catalog-client.js";
import type { InvokeImplementation } from "./native-client.js";

describe("TauriCatalogClient extension center", () => {
  it("keeps custom skills and official plugin commands isolated", async () => {
    const invoke = vi.fn(async () => ({}));
    const client = new TauriCatalogClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await client.listInstalledSkills();
    await client.listConfiguredMcpServers();
    await client.openSkillDirectory("/skills/review/SKILL.md");
    await client.setSkillEnabled("/skills/review/SKILL.md", false);
    await client.setMcpServerEnabled("docs", false);
    await client.listClawhubSkills("review", null, "recommended");
    await client.getClawhubSkill("codex", "review");
    await client.installClawhubSkill("codex", "review", "project", "project-a", "/work");
    await client.listOfficialPlugins(false);
    await client.getOfficialPlugin(
      "openai-api-curated",
      "/cache/api_marketplace.json",
      "game-studio",
    );
    await client.installOfficialPlugin(
      "openai-api-curated",
      "/cache/api_marketplace.json",
      "game-studio",
      "attempt-1",
    );
    await client.uninstallOfficialPlugin("github@openai-curated-remote");

    expect(invoke.mock.calls).toEqual([
      [
        "list_installed_skills",
        { forceReload: false },
      ],
      ["list_configured_mcp_servers"],
      ["open_skill_directory", { path: "/skills/review/SKILL.md" }],
      ["set_skill_enabled", { enabled: false, path: "/skills/review/SKILL.md" }],
      ["set_mcp_server_enabled", { enabled: false, name: "docs" }],
      ["list_clawhub_skills", { cursor: null, query: "review", sort: "recommended" }],
      ["get_clawhub_skill", { owner: "codex", slug: "review" }],
      [
        "install_clawhub_skill",
        {
          owner: "codex",
          projectId: "project-a",
          rootPath: "/work",
          scope: "project",
          slug: "review",
        },
      ],
      ["list_official_plugins", { forceRefetch: false }],
      [
        "get_official_plugin",
        {
          marketplaceName: "openai-api-curated",
          marketplacePath: "/cache/api_marketplace.json",
          pluginName: "game-studio",
        },
      ],
      [
        "install_official_plugin",
        {
          installAttemptId: "attempt-1",
          marketplaceName: "openai-api-curated",
          marketplacePath: "/cache/api_marketplace.json",
          pluginName: "game-studio",
        },
      ],
      ["uninstall_official_plugin", { pluginId: "github@openai-curated-remote" }],
    ]);
  });
});
