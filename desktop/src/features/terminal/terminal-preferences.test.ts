import { describe, expect, it } from "vitest";
import { appPreferenceStorage } from "../../platform/tauri/app-storage.js";
import { loadTerminalPreferences, terminalPreferenceKey } from "./terminal-preferences.js";
import { saveTerminalPreferences } from "./terminal-preferences-write.js";

describe("terminal layout preferences", () => {
  it("persists only layout and an ordinal selection, never terminal identifiers", async () => {
    await saveTerminalPreferences("pref-project", { visible: true, height: 320, selectedIndex: 2 });
    const stored = appPreferenceStorage.getItem(await terminalPreferenceKey("pref-project"));
    expect(JSON.parse(stored ?? "null")).toEqual({ visible: true, height: 320, selectedIndex: 2 });
    expect(await loadTerminalPreferences("pref-project")).toEqual({ visible: true, height: 320, selectedIndex: 2 });
  });
  it("bounds native preference keys even for long Unicode project identifiers", async () => {
    const key = await terminalPreferenceKey("项目".repeat(128));
    expect(key.length).toBeLessThan(512);
    expect(key).not.toEqual(await terminalPreferenceKey("other"));
  });
});
