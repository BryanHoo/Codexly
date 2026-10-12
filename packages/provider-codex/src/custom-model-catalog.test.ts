import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import { mapCustomModels, readDiscoveredModels } from "./custom-model-catalog.js";

const fixtures = JSON.parse(
  await readFile(new URL("./custom-model-catalog-fixtures.json", import.meta.url), "utf8"),
) as { name: string; response: unknown; expected: unknown }[];

describe("mapCustomModels", () => {
  it.each(fixtures)("maps the shared catalog contract: $name", ({ response, expected }) => {
    expect(mapCustomModels(readDiscoveredModels(response, 1000), 1000)).toEqual(expected);
  });
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
