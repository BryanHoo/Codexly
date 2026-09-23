import { describe, expect, it } from "vitest";

import { mapCustomModels } from "./custom-model-catalog.js";

describe("mapCustomModels", () => {
  it("adds the default reasoning levels when a standard catalog omits metadata", () => {
    expect(mapCustomModels([{ id: "gpt-6-sol", name: "GPT-6 Sol" }], 100)).toEqual({
      data: [
        {
          defaultReasoningEffort: "medium",
          description: "",
          displayName: "GPT-6 Sol",
          id: "gpt-6-sol",
          isDefault: true,
          supportedReasoningEfforts: [
            { description: "", id: "low" },
            { description: "", id: "medium" },
            { description: "", id: "high" },
          ],
        },
      ],
      nextCursor: null,
    });
  });
});
