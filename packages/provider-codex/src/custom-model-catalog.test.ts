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
  it("does not invent reasoning capabilities for a plain model ID", () => {
    expect(mapCustomModels([{ id: "custom-model", name: "Custom" }], 100).data[0]).toMatchObject({
      defaultReasoningEffort: "",
      supportedReasoningEfforts: [],
    });
  });
});
