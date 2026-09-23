import { describe, expect, it } from "vitest";

import { createTaskStore } from "../../conversation/runtime/task-store.js";
import {
  createResponse,
  eventEnvelope,
} from "../../conversation/runtime/task-store.test-support.js";
import { WorkbenchInspector, renderInspectorMarkup } from "./workbench-inspector.test-support.js";

describe("WorkbenchInspector runtime warnings", () => {
  it("shows every warning in its own context module with expandable details", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        payload: {
          code: "runtime_warning",
          level: "warning",
          message: "First warning\nFirst detail",
        },
        type: "task.notice",
      },
      {
        ...eventEnvelope(12),
        payload: {
          code: "runtime_warning",
          level: "warning",
          message: "Second warning\nSecond detail",
        },
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
    expect(markup).toContain("First detail");
    expect(markup).toContain("Second warning");
    expect(markup).toContain("Second detail");
    expect(markup).toContain("lucide-triangle-alert");
    expect(markup).not.toContain("text-warning");
  });

  it("hides the module when the task has no runtime warnings", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="context"
        taskId="task-1"
        taskStore={store}
      />,
    );
    expect(markup).not.toContain('aria-label="运行时警告"');
  });
});
