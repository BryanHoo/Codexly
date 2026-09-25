import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { WorkbenchInspector } from "./workbench-inspector.js";
import { getTimelineNotices } from "./task-timeline-store.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { RuntimeWarningsSection } from "./workbench-inspector-runtime-warnings.js";

describe("WorkbenchInspector temporary context", () => {
  it("keeps the context tab and empty state without an active terminal", () => {
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(WorkbenchInspector, {
          contextOnly: true,
          projectName: "Temporary task",
          projectPath: "",
          projectRootId: "",
        }),
      ),
    );

    expect(markup).toContain('role="tab"');
    expect(markup).toContain(i18n.t("inspector.emptyContext", { ns: "conversation" }));
    expect(markup).not.toContain(i18n.t("inspector.terminals", { ns: "conversation" }));
  });
});


it("上下文不再展示项目文件变更模块", () => {
  const markup = renderToStaticMarkup(createElement(TooltipProvider, null,
    createElement(WorkbenchInspector, {
      contextOnly: true, projectName: "Project", projectPath: "/project", projectRootId: "root",
      gitStatus: {
        baseBranches: [], branch: "main", branches: [], repositoryMode: "root", snapshot: "current",
        staged: [], unstaged: [{ path: "file.ts", kind: "create", diff: "+new", stats: { additions: 1, removals: 0 } }],
      },
    }),
  ));
  expect(markup).not.toContain('id="workbench-commit-changes"');
});

it("运行时警告仅显示在右栏上下文模块，详情默认收起", () => {
  const store = createTaskStore({ projectId: "project", taskId: "task" }, {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      id: "task", projectId: "project", title: "Task", pinned: false,
      updatedAt: "2026-09-23T00:00:00Z", status: "running", pendingRequests: [],
      turns: [], turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
      settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model",
        reasoningEffort: "high", sandboxMode: "workspace-write" },
    },
  });
  store.getState().applyEvents([{
    version: 2, provider: "codex", taskId: "task", sessionId: "session",
    sequence: 1, timestamp: "2026-09-23T00:00:01Z", type: "task.notice",
    payload: { code: "runtime_warning", level: "warning", message: "Detailed warning" },
  }]);
  const markup = renderToStaticMarkup(createElement(RuntimeWarningsSection, {
    notices: store.getState().notices,
  }));
  expect(markup).toContain(i18n.t("inspector.runtimeWarnings", { ns: "conversation" }));
  expect(markup).toContain("Detailed warning");
  expect(markup).toContain("<details");
  expect(markup).not.toContain("<details open");
  expect(getTimelineNotices(store.getState().notices)).toEqual([]);
});
