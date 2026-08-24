import { describe, expect, it } from "vitest";

import {
  resolveProjectRootFromSelections,
  resolveSelectedProjectRoot,
  setProjectRootPathChecked,
} from "./project-root-selection.js";

const project = {
  id: "project-1",
  roots: [
    { id: "root-primary", path: "/workspace/primary" },
    { id: "root-secondary", path: "/workspace/secondary" },
  ],
} as const;

describe("project root selection", () => {
  it("defaults to the primary root and keeps a valid secondary selection", () => {
    expect(resolveSelectedProjectRoot(project, undefined)?.path).toBe("/workspace/primary");
    expect(
      resolveSelectedProjectRoot(project, {
        projectId: "project-1",
        rootId: "root-secondary",
      })?.path,
    ).toBe("/workspace/secondary");
  });

  it("falls back when the project or selected root changes", () => {
    expect(
      resolveSelectedProjectRoot(project, {
        projectId: "project-1",
        rootId: "root-missing",
      })?.path,
    ).toBe("/workspace/primary");
    expect(
      resolveSelectedProjectRoot(project, {
        projectId: "another-project",
        rootId: "root-secondary",
      })?.path,
    ).toBe("/workspace/primary");
  });

  it("resolves the active root from Project-level selections for Git activity", () => {
    expect(
      resolveProjectRootFromSelections(project, new Map([[project.id, "root-secondary"]]))?.path,
    ).toBe("/workspace/secondary");
  });

  it("builds an ordered root list from checkbox changes", () => {
    const selected = setProjectRootPathChecked([], "/workspace/primary", true);
    const aggregated = setProjectRootPathChecked(selected, "/workspace/secondary", true);

    expect(aggregated).toEqual(["/workspace/primary", "/workspace/secondary"]);
    expect(setProjectRootPathChecked(aggregated, "/workspace/primary", false)).toEqual([
      "/workspace/secondary",
    ]);
    expect(setProjectRootPathChecked(aggregated, "/workspace/primary", true)).toBe(aggregated);
  });
});
