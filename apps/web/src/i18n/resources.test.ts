import { describe, expect, it } from "vitest";

import { resources } from "./resources.js";

function collectKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    collectKeys(child, prefix.length === 0 ? key : `${prefix}.${key}`),
  );
}

describe("i18n resources", () => {
  it("keeps only the fallback language in the synchronous startup resources", () => {
    expect(Object.keys(resources)).toEqual(["zh-CN"]);
  });

  it("keeps English and Simplified Chinese namespace keys aligned", async () => {
    const { englishResources } = await import("./resources-en.js");
    expect(Object.keys(englishResources).sort()).toEqual(Object.keys(resources["zh-CN"]).sort());

    for (const namespace of Object.keys(englishResources) as (keyof typeof englishResources)[]) {
      expect(collectKeys(englishResources[namespace]).sort()).toEqual(
        collectKeys(resources["zh-CN"][namespace]).sort(),
      );
    }
  });
});
