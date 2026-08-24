import { describe, expect, it } from "vitest";

import { getInspectorMaximumWidth, inspectorWidthLimits } from "./workbench-panel-layout.js";

describe("workbench panel layout", () => {
  it("uses 320px as the inspector default and minimum width", () => {
    expect(inspectorWidthLimits.default).toBe(320);
    expect(inspectorWidthLimits.minimum).toBe(320);
  });

  it("limits the inspector to half of the space remaining after the sidebar", () => {
    expect(getInspectorMaximumWidth(1440, 288)).toBe(576);
    expect(getInspectorMaximumWidth(1440, 400)).toBe(520);
  });
});
