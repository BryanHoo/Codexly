import { describe, expect, it, vi } from "vitest";

import { createFallbackSettings } from "./global-settings-model.js";
import { saveGlobalSettingsDraft } from "./global-settings-save.js";

const browserSettings = {
  background: {
    customImageName: null,
    mode: "bing" as const,
    overlayOpacity: 55,
  },
  customBackgroundImage: null,
  language: "en" as const,
  notificationsEnabled: false,
  theme: "dark" as const,
};

describe("saveGlobalSettingsDraft", () => {
  it("applies browser preferences only after global settings are saved", async () => {
    const order: string[] = [];
    const settings = createFallbackSettings([]);
    const saveGlobalSettings = vi.fn(() => {
      order.push("global");
      return Promise.resolve();
    });
    const applyBrowserSettings = vi.fn(() => {
      order.push("browser");
    });

    await saveGlobalSettingsDraft(settings, browserSettings, {
      applyBrowserSettings,
      saveGlobalSettings,
    });

    expect(order).toEqual(["global", "browser"]);
    expect(applyBrowserSettings).toHaveBeenCalledWith(browserSettings);
  });

  it("does not apply browser preferences when global settings fail to save", async () => {
    const applyBrowserSettings = vi.fn();

    await expect(
      saveGlobalSettingsDraft(createFallbackSettings([]), browserSettings, {
        applyBrowserSettings,
        saveGlobalSettings: () => Promise.reject(new Error("save failed")),
      }),
    ).rejects.toThrow("save failed");

    expect(applyBrowserSettings).not.toHaveBeenCalled();
  });
});
