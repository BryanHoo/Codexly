import { describe, expect, it } from "vitest";

import {
  deriveWorkbenchInspectorActivation,
  getAvailableWorkbenchInspectorTabs,
  shouldEnableProjectGitDetails,
} from "./workbench-inspector-activation.js";

const gitStatus = {
  repositoryMode: "root" as const,
  staged: [{ path: "README.md" }],
  unstaged: [],
};

describe("deriveWorkbenchInspectorActivation", () => {
  it("keeps every inspector panel idle while the inspector is closed", () => {
    expect(
      deriveWorkbenchInspectorActivation({
        gitStatus,
        inspectorOpen: false,
        requestedTab: "context",
        taskId: "task-1",
      }),
    ).toEqual({
      activeTab: "context",
      changes: false,
      context: false,
      file: false,
      history: false,
      project: false,
    });
  });

  it("activates only the selected available panel", () => {
    expect(
      deriveWorkbenchInspectorActivation({
        gitStatus,
        inspectorOpen: true,
        requestedTab: "changes",
        taskId: "task-1",
      }),
    ).toEqual({
      activeTab: "changes",
      changes: true,
      context: false,
      file: false,
      history: false,
      project: false,
    });
  });

  it("activates project when the requested tab is no longer available", () => {
    expect(
      deriveWorkbenchInspectorActivation({
        gitStatus: { ...gitStatus, repositoryMode: "none", staged: [] },
        inspectorOpen: true,
        requestedTab: "changes",
        taskId: "task-1",
      }),
    ).toEqual({
      activeTab: "project",
      changes: false,
      context: false,
      file: false,
      history: false,
      project: true,
    });
  });

  it("returns to the first tab after a commit clears the working tree", () => {
    const clean = { ...gitStatus, staged: [] };
    expect(
      deriveWorkbenchInspectorActivation({
        gitStatus: clean,
        inspectorOpen: true,
        requestedTab: "changes",
        taskId: "task-1",
      }),
    ).toMatchObject({ activeTab: "project", changes: false, project: true });
    expect(getAvailableWorkbenchInspectorTabs("task-1", clean)).not.toContain("changes");
  });

  it("activates context directly for temporary tasks", () => {
    expect(
      deriveWorkbenchInspectorActivation({
        contextOnly: true,
        gitStatus: undefined,
        inspectorOpen: true,
        requestedTab: "project",
        taskId: undefined,
      }),
    ).toEqual({
      activeTab: "context",
      changes: false,
      context: true,
      file: false,
      history: false,
      project: false,
    });
  });

  it("activates an open document and falls back after it closes", () => {
    expect(
      getAvailableWorkbenchInspectorTabs("task-1", gitStatus, {
        contextOnly: false,
      }),
    ).toEqual(["project", "context", "changes", "history"]);
    expect(
      deriveWorkbenchInspectorActivation({
        fileOpen: true,
        gitStatus,
        inspectorOpen: true,
        requestedTab: "document:source:README.md",
        taskId: "task-1",
      }),
    ).toEqual({
      activeTab: "document:source:README.md",
      changes: false,
      context: false,
      file: true,
      history: false,
      project: false,
    });
  });

  it("keeps temporary task navigation scoped to context", () => {
    expect(
      getAvailableWorkbenchInspectorTabs(undefined, undefined, {
        contextOnly: true,
      }),
    ).toEqual(["context"]);
  });

  it("keeps detailed Git reads disabled for non-Git projects", () => {
    expect(
      shouldEnableProjectGitDetails({
        activePanel: true,
        gitStatus: {
          repositoryMode: "none",
          staged: [{ path: "unexpected.ts" }],
          unstaged: [],
        },
        temporary: false,
      }),
    ).toBe(false);
  });
});
