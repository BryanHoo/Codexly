import { describe, expect, it } from "vitest";

import { shouldEnableWorkbenchSkills } from "./workbench-query-availability.js";

describe("shouldEnableWorkbenchSkills", () => {
  it("disables project skills for temporary tasks", () => {
    expect(shouldEnableWorkbenchSkills(true, true)).toBe(false);
  });

  it("enables project skills only when the capability is available", () => {
    expect(shouldEnableWorkbenchSkills(true, false)).toBe(true);
    expect(shouldEnableWorkbenchSkills(false, false)).toBe(false);
  });
});
