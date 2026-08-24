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
  it("keeps English and Simplified Chinese namespace keys aligned", () => {
    expect(Object.keys(resources.en).sort()).toEqual(Object.keys(resources["zh-CN"]).sort());

    for (const namespace of Object.keys(resources.en) as (keyof typeof resources.en)[]) {
      expect(collectKeys(resources.en[namespace]).sort()).toEqual(
        collectKeys(resources["zh-CN"][namespace]).sort(),
      );
    }
  });
});
