import { describe, expect, it } from "vitest";

import { isComposerControllerScopeCurrent } from "./use-workbench-composer-controller.js";

describe("Workbench composer controller", () => {
  it("accepts async results only for the active route scope", () => {
    expect(isComposerControllerScopeCurrent("project-1:task-1", "project-1:task-1")).toBe(true);
    expect(isComposerControllerScopeCurrent("project-1:task-2", "project-1:task-1")).toBe(false);
  });
});
