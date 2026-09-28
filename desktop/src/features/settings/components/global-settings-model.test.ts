import { expect, it } from "vitest";

import { createFallbackSettings } from "./global-settings-model.js";

it("uses GPT-6 Luna as the fallback commit message model", () => {
  expect(createFallbackSettings([]).commitMessageModel).toBe("gpt-6-luna");
});
