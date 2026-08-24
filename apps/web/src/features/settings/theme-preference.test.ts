import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyThemePreference,
  initializeThemePreference,
  readThemePreference,
  saveThemePreference,
  setThemePreference,
} from "./theme-preference.js";

describe("theme preference", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the versioned preference and falls back to system for invalid data", () => {
    expect(readThemePreference({ getItem: () => '{"theme":"dark","version":1}' })).toBe("dark");
    expect(readThemePreference({ getItem: () => '{"theme":"system","version":1}' })).toBe("system");
    expect(readThemePreference({ getItem: () => "broken" })).toBe("system");
    expect(readThemePreference({ getItem: () => null })).toBe("system");
  });

  it("persists and applies the selected theme", () => {
    const setItem = vi.fn();
    const root = { dataset: {} as Record<string, string | undefined> };

    saveThemePreference("dark", { setItem });
    applyThemePreference("dark", root);

    expect(setItem).toHaveBeenCalledWith(
      "codexly.theme-preference",
      '{"theme":"dark","version":1}',
    );
    expect(root.dataset["theme"]).toBe("dark");
  });

  it("follows system changes only while the automatic preference is active", () => {
    let prefersDark = false;
    const listeners = new Set<EventListener>();
    const removeEventListener = vi.fn((_type: string, listener: EventListener) => {
      listeners.delete(listener);
    });
    const mediaQuery = {
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        listeners.add(listener);
      }),
      get matches() {
        return prefersDark;
      },
      removeEventListener,
    } as unknown as MediaQueryList;
    const setItem = vi.fn();
    const root = { dataset: {} as Record<string, string | undefined> };

    vi.stubGlobal("window", {
      localStorage: { getItem: () => null, setItem },
      matchMedia: vi.fn(() => mediaQuery),
    });
    vi.stubGlobal("document", { documentElement: root });

    expect(initializeThemePreference()).toBe("system");
    expect(root.dataset["theme"]).toBe("light");

    prefersDark = true;
    for (const listener of listeners) listener(new Event("change"));
    expect(root.dataset["theme"]).toBe("dark");

    setThemePreference("light");
    expect(setItem).toHaveBeenCalledWith(
      "codexly.theme-preference",
      '{"theme":"light","version":1}',
    );
    expect(removeEventListener).toHaveBeenCalledOnce();

    prefersDark = false;
    for (const listener of listeners) listener(new Event("change"));
    expect(root.dataset["theme"]).toBe("light");
  });
});
