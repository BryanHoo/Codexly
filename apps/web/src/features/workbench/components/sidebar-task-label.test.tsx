import { taskEngine, type AgentEngine } from "@codexly/protocol";
import { SelectedEnginesContext } from "@codexly/ui/core/engine-selection";
import { SidebarTaskLabel } from "@codexly/ui/core/sidebar-task-label";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

function renderLabel(label: ReactNode) {
  return renderToStaticMarkup(
    <SelectedEnginesContext value={["codex", "claude"]}>{label}</SelectedEnginesContext>,
  );
}

describe("SidebarTaskLabel", () => {
  it.each<{ engines: readonly AgentEngine[] | undefined }>([
    { engines: undefined },
    { engines: [] },
    { engines: ["codex"] },
    { engines: ["claude"] },
  ])(
    "hides logos and their placeholder unless both engines are configured: $engines",
    ({ engines }) => {
      for (const engine of ["codex", "claude", undefined] as const) {
        const markup = renderToStaticMarkup(
          <SelectedEnginesContext value={engines}>
            <SidebarTaskLabel engine={engine} projectName="项目名称" title="任务标题" />
          </SelectedEnginesContext>,
        );
        expect(markup).not.toContain("<svg");
        expect(markup).not.toContain('aria-hidden="true" class="size-3.5 shrink-0"');
        expect(markup).toContain('title="项目名称"');
        expect(markup).toContain('title="任务标题"');
      }
    },
  );

  it.each(["codex", "claude"] as const)("renders the %s logo before the task title", (engine) => {
    const label = engine === "claude" ? "Claude" : "Codex";
    const markup = renderLabel(<SidebarTaskLabel engine={engine} title="任务标题" />);
    expect(markup).toContain(`aria-label="${label}"`);
    expect(markup).toContain(`<title>${label}</title>`);
    expect(markup).toContain('width="14"');
    expect(markup).toContain('height="14"');
    expect(markup).toContain("size-3.5 shrink-0");
    expect(markup).toContain("gap-1.5");
    expect(markup.indexOf("<svg")).toBeLessThan(markup.indexOf('title="任务标题"'));
    expect(markup).toContain("min-w-0 flex-1 truncate");
    expect(markup).not.toContain("<img");
  });

  it("keeps the project tag between the logo and the truncated title", () => {
    const markup = renderLabel(
      <SidebarTaskLabel engine="claude" projectName="项目名称" title="任务标题" />,
    );
    expect(markup.indexOf("<svg")).toBeLessThan(markup.indexOf('title="项目名称"'));
    expect(markup.indexOf('title="项目名称"')).toBeLessThan(markup.indexOf('title="任务标题"'));
    expect(markup).toContain("max-w-[40%]");
  });

  it("uses Codex for legacy tasks but does not guess unknown activity identity", () => {
    expect(renderLabel(<SidebarTaskLabel engine={taskEngine({})} title="历史任务" />)).toContain(
      'aria-label="Codex"',
    );
    const markup = renderLabel(<SidebarTaskLabel engine={undefined} title="活动任务" />);
    expect(markup).not.toContain("<svg");
    expect(markup).toContain('aria-hidden="true" class="size-3.5 shrink-0"');
    expect(markup).toContain("活动任务");
  });
});
