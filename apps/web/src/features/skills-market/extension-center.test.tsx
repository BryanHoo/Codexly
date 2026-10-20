import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ExtensionList } from "@codexly/ui/core/extension-list";
import { ExtensionCenter } from "@codexly/ui/core/extension-center";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { SelectedEnginesContext } from "@codexly/ui/core/engine-selection";

it("renders two engine choices, section navigation and the existing Codex content", () => {
  const markup = renderToStaticMarkup(
    <TooltipProvider>
      <ExtensionCenter
        client={{
          listClaudeExtensions: () => Promise.resolve({ data: [] }),
          mutateClaudeExtension: () => Promise.resolve({ data: [] }),
        }}
        projects={[]}
        section="skills"
        onSectionChange={() => undefined}
        t={(key) => key}
        codexContent={<div>Codex skills</div>}
      />
    </TooltipProvider>,
  );
  expect(markup).toContain("Claude");
  expect(markup).toContain("Codex skills");
  expect(markup).toContain('data-slot="select-trigger"');
  expect(markup.match(/role="tab"/g)).toHaveLength(3);
  expect(markup).toContain('aria-pressed="true"');
  expect(markup).not.toContain("extension-center__intro");
  expect(markup).not.toContain("extension-center__mark");
  expect(markup).not.toContain("skillsMarket.center.subtitle");
});

it("opens Claude directly for Claude-only users and uses the shared scope selector", () => {
  const markup = renderToStaticMarkup(
    <TooltipProvider>
      <SelectedEnginesContext.Provider value={["claude"]}>
        <ExtensionCenter
          client={{
            listClaudeExtensions: () => Promise.resolve({ data: [] }),
            mutateClaudeExtension: () => Promise.resolve({ data: [] }),
          }}
          projects={[{ id: "project-a", name: "Project A" }]}
          section="mcp"
          onSectionChange={() => undefined}
          t={(key) => key}
          codexContent={<div>Codex must stay unmounted</div>}
        />
      </SelectedEnginesContext.Provider>
    </TooltipProvider>,
  );
  expect(markup).toContain('data-slot="select-trigger"');
  expect(markup).not.toContain("Codex must stay unmounted");
  expect(markup).not.toContain("添加 MCP");
});

it("mounts only a bounded initial window for a large official plugin catalog", () => {
  const items = Array.from({ length: 300 }, (_, index) => ({
    id: `plugin-${String(index)}`,
    name: `Plugin ${String(index)}`,
    description: "Catalog item",
    scope: "user",
    installed: false,
    enabled: false,
    mutable: true,
  }));
  const markup = renderToStaticMarkup(
    <ExtensionList items={items} renderItem={(item) => <li key={item.id}>{item.name}</li>} />,
  );
  expect(markup.match(/<li/g)?.length).toBeLessThan(20);
  expect(markup).toContain("Plugin 0");
  expect(markup).not.toContain("Plugin 299");
});
