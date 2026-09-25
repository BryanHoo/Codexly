import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appPreferenceStorage,
  initializeAppStorage,
  readNativeCustomBackground,
  resetAppStorageForTest,
} from "./app-storage.js";

describe("native app storage", () => {
  beforeEach(() => resetAppStorageForTest());

  it("migrates CodeAgent localStorage values and clears them after native persistence", async () => {
    const legacy = new Map([
      ["codeagent.theme-preference", "dark"],
      ["unrelated", "keep"],
    ]);
    const localStorage = {
      getItem: (key: string) => legacy.get(key) ?? null,
      key: (index: number) => [...legacy.keys()][index] ?? null,
      get length() {
        return legacy.size;
      },
      removeItem: (key: string) => legacy.delete(key),
    };
    const invoke = vi.fn(async () => ({ "codeagent.theme-preference": "dark" }));

    await initializeAppStorage({ invoke, localStorage, readLegacyBackgrounds: async () => [] });

    expect(invoke).toHaveBeenCalledWith("initialize_app_storage", {
      legacyBackgrounds: [],
      legacyPreferences: { "codeagent.theme-preference": "dark" },
    });
    expect(appPreferenceStorage.getItem("codeagent.theme-preference")).toBe("dark");
    expect(legacy.has("codeagent.theme-preference")).toBe(false);
    expect(legacy.get("unrelated")).toBe("keep");
  });

  it("keeps legacy data when initialization fails", async () => {
    const removeItem = vi.fn();
    const localStorage = {
      getItem: () => "dark",
      key: () => "codeagent.theme-preference",
      length: 1,
      removeItem,
    };

    await expect(
      initializeAppStorage({
        invoke: async () => Promise.reject(new Error("native unavailable")),
        localStorage,
        readLegacyBackgrounds: async () => [],
      }),
    ).rejects.toThrow("native unavailable");
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("mirrors writes immediately and delegates persistence to Rust", async () => {
    const invoke = vi.fn(async () => ({}));
    await initializeAppStorage({ invoke, readLegacyBackgrounds: async () => [] });

    appPreferenceStorage.setItem("codeagent.language-preference", "zh-CN");
    appPreferenceStorage.setItem("codeagent.language-preference", "en");
    appPreferenceStorage.setItem("codeagent.theme-preference", "dark");
    expect(appPreferenceStorage.getItem("codeagent.language-preference")).toBe("en");

    expect(invoke).toHaveBeenNthCalledWith(2, "update_app_preferences", {
      updates: { "codeagent.language-preference": "zh-CN" },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "update_app_preferences", {
      updates: { "codeagent.language-preference": "en" },
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "update_app_preferences", {
      updates: { "codeagent.theme-preference": "dark" },
    });
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("reads custom background bytes from a binary IPC response", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const invoke = vi.fn(async (command: string) =>
      command === "read_custom_background" ? bytes.buffer : {},
    );
    await initializeAppStorage({ invoke, readLegacyBackgrounds: async () => [] });

    const image = await readNativeCustomBackground("background-1", "image/png");

    expect(invoke).toHaveBeenLastCalledWith("read_custom_background", {
      id: "background-1",
    });
    expect(image.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await image.arrayBuffer()))).toEqual(Array.from(bytes));
  });
});
