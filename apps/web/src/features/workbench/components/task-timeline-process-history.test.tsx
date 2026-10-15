import { expect, it, vi } from "vitest";
import {
  ProjectDataContext,
  type ProjectDataContextValue,
} from "../../projects/project-context-state.js";
import { TaskSnapshotTimeline } from "./task-timeline.js";
import { renderToStaticMarkup, snapshot } from "./task-timeline.test-support.js";

it.each(["completed", "failed", "interrupted"] as const)(
  "keeps the %s summary process lazy even without an assistant answer or timestamps",
  (status) => {
    const readTask = vi.fn();
    const summary = {
      ...snapshot,
      turns: [
        {
          id: "summary-turn",
          status,
          startedAt: null,
          completedAt: null,
          error: null,
          processCursor: "independent-process",
          items: [
            { id: "question", type: "message" as const, role: "user" as const, text: "历史问题" },
          ],
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <ProjectDataContext.Provider
        value={{ client: { readTask } } as unknown as ProjectDataContextValue}
      >
        <TaskSnapshotTimeline snapshot={summary} />
      </ProjectDataContext.Provider>,
    );
    expect(markup).toContain("历史问题");
    expect(markup).toContain('aria-label="展开执行过程"');
    expect(markup).not.toContain("data-turn-process=");
    expect(readTask).not.toHaveBeenCalled();
  },
);
