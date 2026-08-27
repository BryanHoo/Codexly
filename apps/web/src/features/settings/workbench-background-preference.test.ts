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
          '{"blurPercentage":8,"customImageName":"desk.jpg","mode":"custom","overlayOpacity":72,"version":2}',
      }),
    ).toEqual({
      blurPercentage: 8,
      customImageName: "desk.jpg",
      mode: "custom",
      overlayOpacity: 72,
    });
    expect(
      readWorkbenchBackgroundPreference({
        getItem: () =>
          '{"blurPercentage":0,"customImageName":null,"mode":"bing","overlayOpacity":0,"version":2}',
      }),
    ).toEqual({ blurPercentage: 0, customImageName: null, mode: "bing", overlayOpacity: 0 });
    expect(
      readWorkbenchBackgroundPreference({
        getItem: () =>
          '{"blurPercentage":96,"customImageName":null,"mode":"bing","overlayOpacity":60,"version":2}',
      }),
    ).toEqual(DEFAULT_WORKBENCH_BACKGROUND);
    expect(readWorkbenchBackgroundPreference({ getItem: () => "broken" })).toEqual(
      DEFAULT_WORKBENCH_BACKGROUND,
    );
  });

  it("persists the selected mode, image name, overlay opacity, and blur", () => {
    const setItem = vi.fn();

    saveWorkbenchBackgroundPreference(
      {
        blurPercentage: 57,
        customImageName: "workspace.webp",
        mode: "custom",
        overlayOpacity: 45,
      },
      { setItem },
    );

    expect(setItem).toHaveBeenCalledWith(
      "codexly.workbench-background-preference",
      '{"blurPercentage":57,"customImageName":"workspace.webp","mode":"custom","overlayOpacity":45,"version":2}',
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
