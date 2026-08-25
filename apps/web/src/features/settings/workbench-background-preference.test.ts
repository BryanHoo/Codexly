import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WORKBENCH_BACKGROUND,
  isSupportedCustomBackgroundImage,
  readWorkbenchBackgroundPreference,
  saveWorkbenchBackgroundPreference,
} from "./workbench-background-preference.js";

describe("workbench background preference", () => {
  it("reads valid versioned preferences and falls back for invalid values", () => {
    expect(
      readWorkbenchBackgroundPreference({
        getItem: () =>
          '{"customImageName":"desk.jpg","mode":"custom","overlayOpacity":72,"version":1}',
      }),
    ).toEqual({ customImageName: "desk.jpg", mode: "custom", overlayOpacity: 72 });
    expect(
      readWorkbenchBackgroundPreference({
        getItem: () => '{"customImageName":null,"mode":"bing","overlayOpacity":0,"version":1}',
      }),
    ).toEqual({ customImageName: null, mode: "bing", overlayOpacity: 0 });
    expect(
      readWorkbenchBackgroundPreference({
        getItem: () => '{"customImageName":null,"mode":"bing","overlayOpacity":96,"version":1}',
      }),
    ).toEqual(DEFAULT_WORKBENCH_BACKGROUND);
    expect(readWorkbenchBackgroundPreference({ getItem: () => "broken" })).toEqual(
      DEFAULT_WORKBENCH_BACKGROUND,
    );
  });

  it("persists the selected mode, image name, and overlay opacity", () => {
    const setItem = vi.fn();

    saveWorkbenchBackgroundPreference(
      { customImageName: "workspace.webp", mode: "custom", overlayOpacity: 45 },
      { setItem },
    );

    expect(setItem).toHaveBeenCalledWith(
      "codexly.workbench-background-preference",
      '{"customImageName":"workspace.webp","mode":"custom","overlayOpacity":45,"version":1}',
    );
  });

  it("accepts only bounded raster image uploads", () => {
    expect(isSupportedCustomBackgroundImage({ size: 1024, type: "image/jpeg" })).toBe(true);
    expect(isSupportedCustomBackgroundImage({ size: 1024, type: "image/svg+xml" })).toBe(false);
    expect(isSupportedCustomBackgroundImage({ size: 21 * 1024 * 1024, type: "image/png" })).toBe(
      false,
    );
  });
});
