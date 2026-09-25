import { describe, expect, it } from "vitest";

import {
  resolveInspectorVisibility,
  resolveQuickOpenVisibility,
} from "./workbench-panel-layout.js";

describe("resolveInspectorVisibility", () => {
  it("进入任务看板时始终隐藏右栏", () => {
    expect(resolveInspectorVisibility(true, true)).toBe(false);
    expect(resolveInspectorVisibility(true, false)).toBe(false);
    expect(resolveInspectorVisibility(false, true)).toBe(true);
  });
});

describe("resolveQuickOpenVisibility", () => {
  it("进入任务看板时隐藏快捷打开", () => {
    expect(resolveQuickOpenVisibility(true, false)).toBe(false);
    expect(resolveQuickOpenVisibility(false, true)).toBe(false);
    expect(resolveQuickOpenVisibility(false, false)).toBe(true);
  });
});
