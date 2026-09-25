import { describe, expect, it } from "vitest";

import { shouldRefreshTaskDefaults } from "./global-settings-effects.js";

describe("shouldRefreshTaskDefaults", () => {
  it("should ignore global fields unrelated to task defaults", () => {
    expect(
      shouldRefreshTaskDefaults([
        "commitMessageModel",
        "commitMessagePrompt",
        "defaultOpenAppId",
        "followUpBehavior",
        "pet",
      ]),
    ).toBe(false);
  });

  it("should refresh when a task default field changed", () => {
    expect(shouldRefreshTaskDefaults(["model"])).toBe(true);
    expect(shouldRefreshTaskDefaults(["sandboxMode"])).toBe(true);
  });
});
