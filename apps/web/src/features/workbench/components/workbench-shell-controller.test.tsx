import { describe, expect, it } from "vitest";

import {
  createProjectTaskDefaults,
  resolveProjectFastModeDefault,
} from "./workbench-shell-controller.js";

const taskSettings = {
  approvalPolicy: "never" as const,
  approvalsReviewer: "user" as const,
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "danger-full-access" as const,
};

describe("WorkbenchShellController project task defaults", () => {
  it("converts the latest task controls into complete project defaults", () => {
    expect(createProjectTaskDefaults(taskSettings, true)).toEqual({
      ...taskSettings,
      fastMode: true,
    });
  });

  it("uses project fast mode for normal tasks and Global fast mode for temporary tasks", () => {
    expect(resolveProjectFastModeDefault(false, false, true)).toBe(false);
    expect(resolveProjectFastModeDefault(false, undefined, true)).toBe(true);
    expect(resolveProjectFastModeDefault(true, false, true)).toBe(true);
  });
});
