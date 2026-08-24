import { describe, expect, it } from "vitest";

import { moveProject, moveProjectByOffset } from "./use-project-reordering.js";

describe("project reordering", () => {
  it("moves a dragged project before or after the hovered project", () => {
    const projectIds = ["alpha", "beta", "gamma"];

    expect(moveProject(projectIds, "alpha", "gamma", "after")).toEqual(["beta", "gamma", "alpha"]);
    expect(moveProject(projectIds, "gamma", "alpha", "before")).toEqual(["gamma", "alpha", "beta"]);
    expect(moveProject(projectIds, "alpha", "alpha", "before")).toBe(projectIds);
  });

  it("moves a keyboard-selected project by one position without crossing boundaries", () => {
    const projectIds = ["alpha", "beta", "gamma"];

    expect(moveProjectByOffset(projectIds, "beta", -1)).toEqual(["beta", "alpha", "gamma"]);
    expect(moveProjectByOffset(projectIds, "beta", 1)).toEqual(["alpha", "gamma", "beta"]);
    expect(moveProjectByOffset(projectIds, "alpha", -1)).toBe(projectIds);
    expect(moveProjectByOffset(projectIds, "gamma", 1)).toBe(projectIds);
  });
});
