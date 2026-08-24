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
        gitStatus: { ...gitStatus, staged: [] },
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

  it("adds and activates the file panel only while a file is selected", () => {
    expect(
      getAvailableWorkbenchInspectorTabs("task-1", gitStatus, {
        contextOnly: false,
        fileOpen: false,
      }),
    ).toEqual(["context", "project", "changes", "history"]);
    expect(
      getAvailableWorkbenchInspectorTabs("task-1", gitStatus, {
        contextOnly: false,
        fileOpen: true,
      }),
    ).toEqual(["context", "project", "changes", "history", "file"]);
    expect(
      deriveWorkbenchInspectorActivation({
        fileOpen: true,
        gitStatus,
        inspectorOpen: true,
        requestedTab: "file",
        taskId: "task-1",
      }),
    ).toEqual({
      activeTab: "file",
      changes: false,
      context: false,
      file: true,
      history: false,
      project: false,
    });
  });

  it("offers context and file tabs for a temporary task with an open file", () => {
    expect(
      getAvailableWorkbenchInspectorTabs(undefined, undefined, {
        contextOnly: true,
        fileOpen: true,
      }),
    ).toEqual(["context", "file"]);
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
