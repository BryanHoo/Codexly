import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectedEnginesContext } from "@codexly/ui/core/engine-selection";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { ProjectSidebarHeader } from "./project-sidebar-header.js";

it("exposes global search for Claude-only and dual-engine configurations", () => {
  const render = (engines: readonly ("codex" | "claude")[]) =>
    renderToStaticMarkup(
      <SelectedEnginesContext value={engines}>
        <TooltipProvider>
          <ProjectSidebarHeader onClose={vi.fn()} onSearch={vi.fn()} />
        </TooltipProvider>
      </SelectedEnginesContext>,
    );
  expect(render(["claude"])).toContain("lucide-search");
  expect(render(["claude", "codex"])).toContain("lucide-search");
});
