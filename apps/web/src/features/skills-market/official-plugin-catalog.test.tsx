import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { OfficialPluginSummary } from "@codexly/protocol";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { InstalledSkillsPane } from "./installed-skills-pane.js";
import { McpManagementPane } from "./mcp-management-pane.js";
import { ExtensionProjectScope } from "@codexly/ui/core/extension-project-scope";
import { OfficialPluginsPane } from "./official-plugins-pane.js";

const mocks = vi.hoisted(() => ({
  listOfficialPlugins: vi.fn(),
  reconcileOfficialPlugins: vi.fn(),
  listInstalledSkills: vi.fn(),
  listConfiguredMcpServers: vi.fn(),
  setSkillEnabled: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  openSkillDirectory: vi.fn(),
  installOfficialPlugin: vi.fn(),
  uninstallOfficialPlugin: vi.fn(),
  getOfficialPlugin: vi.fn(),
}));
vi.mock("../projects/project-context.js", () => ({
  useProjectData: () => ({ client: mocks, projects: [] }),
}));
vi.mock("../../i18n/i18n.js", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const plugin = (name: string, installed = false): OfficialPluginSummary => ({
  id: `${name}@openai-curated`,
  name,
  displayName: name,
  description: "Official plugin description",
  developerName: "OpenAI",
  logoUrl: null,
  enabled: installed,
  installed,
  version: "1.0.0",
  localVersion: installed ? "1.0.0" : null,
  authPolicy: "ON_INSTALL",
  availability: "AVAILABLE",
  installPolicy: "AVAILABLE",
  disabledReason: null,
  marketplaceName: "openai-curated",
  marketplacePath: null,
  pluginName: name,
});
const render = (cache: QueryClient) =>
  renderToStaticMarkup(
    <QueryClientProvider client={cache}>
      <TooltipProvider>
        <OfficialPluginsPane />
      </TooltipProvider>
    </QueryClientProvider>,
  );

it("uses the same compact list, search, filter and inline plugin actions as Claude", () => {
  const cache = new QueryClient();
  cache.setQueryData(["extensions", "plugins"], {
    data: [
      plugin("alpha"),
      plugin("beta", true),
      {
        ...plugin("blocked"),
        availability: "DISABLED_BY_ADMIN",
        disabledReason: "Blocked by administrator",
      },
    ],
  });
  try {
    const html = render(cache);
    expect(html).toContain('class="extension-list"');
    expect(html).toContain('class="extension-search"');
    expect(html).toContain('data-slot="select-trigger"');
    expect(html).toContain("skillsMarket.installPlugin");
    expect(html).toContain("skillsMarket.center.remove");
    expect(html).not.toContain("official-plugin-card");
    expect(html).not.toContain("official-plugin-group");
    const blocked = html.match(/<li\b[\s\S]*?<\/li>/g)?.find((row) => row.includes("blocked"));
    expect(blocked).toContain('disabled=""');
  } finally {
    cache.clear();
  }
});

it.each(["skills", "mcp"] as const)(
  "uses shared rows and search for Codex %s while retaining project isolation",
  (kind) => {
    const cache = new QueryClient();
    const skill = {
      id: "project-skill",
      name: "Project Skill",
      displayName: "Project Skill",
      description: "Project guidance",
      path: "/work/SKILL.md",
      scope: "repo",
      source: "local",
      enabled: true,
      projectId: "project-a",
    };
    cache.setQueryData(["extensions", "skills"], {
      data: [
        skill,
        {
          ...skill,
          id: "global-skill",
          displayName: "Global Skill",
          scope: "user",
          projectId: undefined,
        },
      ],
      nextCursor: null,
    });
    cache.setQueryData(["extensions", "mcp", "project-a"], {
      data: [{ name: "Project MCP", enabled: true, mutable: false }],
    });
    try {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={cache}>
          <TooltipProvider>
            <ExtensionProjectScope.Provider value="project-a">
              {kind === "skills" ? <InstalledSkillsPane /> : <McpManagementPane />}
            </ExtensionProjectScope.Provider>
          </TooltipProvider>
        </QueryClientProvider>,
      );
      expect(html).toContain('class="extension-list"');
      expect(html).toContain('class="extension-search"');
      expect(html).not.toContain("Global Skill");
      if (kind === "mcp") expect(html).toContain('disabled=""');
      else expect(html).toContain("Project Skill");
    } finally {
      cache.clear();
    }
  },
);

it("keeps other Codex install buttons enabled while one plugin is installing", async () => {
  const cache = new QueryClient();
  const alpha = plugin("alpha");
  cache.setQueryData(["extensions", "plugins"], { data: [alpha, plugin("beta")] });
  let release: (() => void) | undefined;
  const mutation = cache
    .getMutationCache()
    .build<
      unknown,
      Error,
      { id: string; plugin: OfficialPluginSummary; action: "install" },
      unknown
    >(cache, {
      mutationKey: ["extensions", "plugins", "operations"],
      mutationFn: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
  const request = mutation.execute({ id: alpha.id, plugin: alpha, action: "install" });
  await Promise.resolve();
  try {
    const rows = render(cache).match(/<li\b[\s\S]*?<\/li>/g) ?? [];
    expect(rows.find((row) => row.includes(">alpha<"))).toContain('aria-busy="true"');
    expect(rows.find((row) => row.includes(">alpha<"))).toContain("animate-spin");
    expect(rows.find((row) => row.includes(">beta<"))).not.toContain('disabled=""');
  } finally {
    release?.();
    await request;
    cache.clear();
  }
});
