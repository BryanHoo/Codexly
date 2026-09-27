import { describe, expect, it } from "vitest";

import { createTaskStore } from "../../conversation/runtime/task-store.js";
import {
  createResponse,
  eventEnvelope,
} from "../../conversation/runtime/task-store.test-support.js";
import { WorkbenchInspector, renderInspectorMarkup } from "./workbench-inspector.test-support.js";

describe("WorkbenchInspector runtime warnings", () => {
  it("shows each runtime warning in context, collapsed by default", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        payload: { code: "runtime_warning", level: "warning", message: "First warning\nDetail" },
        type: "task.notice",
      },
      {
        ...eventEnvelope(12),
        payload: { code: "runtime_warning", level: "warning", message: "Second warning" },
        type: "task.notice",
      },
    ]);
    Object.assign(store.getInitialState(), { notices: store.getState().notices });

    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        contextOnly
        projectName="Codexly"
        projectPath=""
        tab="context"
        taskId="task-1"
        taskStore={store}
      />,
    );

    expect(markup).toContain('aria-label="运行时警告"');
    expect(markup.match(/data-runtime-warning=""/gu)).toHaveLength(2);
    expect(markup).toContain("First warning");
    expect(markup).toContain("Second warning");
    expect(markup).not.toMatch(/<details[^>]*data-runtime-warning=""[^>]*open=/su);
  });
});
