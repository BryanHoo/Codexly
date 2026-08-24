import type { AgentTaskPage } from "@codexly/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { ArchivedTaskListView } from "./archived-tasks-dialog.js";

const page: AgentTaskPage = {
  data: [
    {
      id: "archived-1",
      pinned: false,
      projectId: "codexly",
      title: "归档任务一",
      updatedAt: "2026-08-23T00:00:00.000Z",
    },
    {
      id: "archived-2",
      pinned: false,
      projectId: "codexly",
      title: "归档任务二",
      updatedAt: "2026-08-22T00:00:00.000Z",
    },
  ],
  nextCursor: "next-page",
};

describe("ArchivedTaskListView", () => {
  it("renders archived tasks with restore, delete and cursor pagination controls", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ArchivedTaskListView
          error={null}
          isPending={false}
          mutationPending={false}
          onDelete={vi.fn()}
          onDeleteAll={vi.fn()}
          onNext={vi.fn()}
          onPrevious={vi.fn()}
          onRestore={vi.fn()}
          page={page}
          pageNumber={2}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain("<ul");
    expect(markup).toContain("归档任务一");
    expect(markup).toContain("归档任务二");
    expect(markup).toContain('aria-label="恢复任务 归档任务一"');
    expect(markup).toContain('aria-label="永久删除任务 归档任务一"');
    expect(markup).toContain("全部删除");
    expect(markup).toContain('aria-label="上一页"');
    expect(markup).toContain('aria-label="下一页"');
    expect(markup).toContain("第 2 页");
  });

  it("renders a stable empty search result", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ArchivedTaskListView
          error={null}
          isPending={false}
          mutationPending={false}
          onDelete={vi.fn()}
          onDeleteAll={vi.fn()}
          onNext={vi.fn()}
          onPrevious={vi.fn()}
          onRestore={vi.fn()}
          page={{ data: [], nextCursor: null }}
          pageNumber={1}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain("没有已归档任务");
    expect(markup).not.toContain("<ul");
  });
});
