import { describe, expect, it } from "vitest";
import { isTerminalShortcut } from "./terminal-shortcut.js";
import { clampTerminalHeight } from "./terminal-panel-layout.js";

const key = { key: "j", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: false, isComposing: false, defaultPrevented: false };
describe("terminal workbench controls", () => {
  it("matches only the platform shortcut without repeat, composition or extra modifiers", () => {
    expect(isTerminalShortcut(key, true)).toBe(true);
    expect(isTerminalShortcut(key, false)).toBe(false);
    expect(isTerminalShortcut({ ...key, metaKey: false, ctrlKey: true }, false)).toBe(true);
    expect(isTerminalShortcut({ ...key, repeat: true }, true, true)).toBe(true);
    for (const flag of ["repeat", "isComposing", "shiftKey", "altKey", "ctrlKey", "defaultPrevented"] as const) expect(isTerminalShortcut({ ...key, [flag]: true }, true)).toBe(false);
  });
  it("clamps short windows without an inverted height range", () => {
    expect(clampTerminalHeight(280, 800)).toBe(280);
    expect(clampTerminalHeight(800, 600)).toBe(360);
    expect(clampTerminalHeight(280, 300)).toBe(60);
    expect(clampTerminalHeight(280, 200)).toBe(0);
  });
});
