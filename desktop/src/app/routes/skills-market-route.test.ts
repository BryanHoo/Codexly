import { describe, expect, it } from "vitest";

import "../router.js";
import {
  projectExtensionsRoute,
  temporaryExtensionsRoute,
} from "./extensions-route.js";

describe("extension center routes", () => {
  it("keeps project and temporary section paths stable", () => {
    expect(projectExtensionsRoute.fullPath).toBe("/p/$projectId/extensions/$section");
    expect(temporaryExtensionsRoute.fullPath).toBe("/temporary/extensions/$section");
  });
});
