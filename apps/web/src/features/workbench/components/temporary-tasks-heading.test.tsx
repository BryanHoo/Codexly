import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { TemporaryTasksHeading } from "./temporary-tasks-heading.js";

describe("TemporaryTasksHeading", () => {
  it("在新建按钮左侧显示 hover 后可见的归档按钮", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <TemporaryTasksHeading
          expanded
          onCreate={vi.fn()}
          onOpenArchived={vi.fn()}
          onToggle={vi.fn()}
        />
      </TooltipProvider>,
    );

    const archivedButtonPosition = markup.indexOf('aria-label="已归档"');
    const createButtonPosition = markup.indexOf('aria-label="新建任务"');

    expect(archivedButtonPosition).toBeGreaterThanOrEqual(0);
    expect(createButtonPosition).toBeGreaterThan(archivedButtonPosition);
    expect(markup).toMatch(
      /class="[^"]*opacity-0[^"]*focus-visible:opacity-100[^"]*group-hover\/temporary:opacity-100[^"]*"[^>]*aria-label="已归档"[^>]*id="project-actions-temporary"/u,
    );
  });
});
