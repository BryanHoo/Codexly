import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WORKBENCH_BACKGROUND,
  isSupportedCustomBackgroundImage,
  removeCustomBackgroundFromDraft,
  readWorkbenchBackgroundPreference,
  saveWorkbenchBackgroundPreference,
} from "./workbench-background-preference.js";

describe("workbench background preference", () => {
  it("reads valid versioned preferences and falls back for invalid values", () => {
    expect(
      readWorkbenchBackgroundPreference({
        getItem: () =>
          '{"blurPercentage":8,"mode":"custom","overlayOpacity":72,"selectedCustomImageId":"image-2","version":3}',
      }),
    ).toEqual({
      blurPercentage: 8,
      mode: "custom",
      overlayOpacity: 72,
      selectedCustomImageId: "image-2",
    });
    expect(
      readWorkbenchBackgroundPreference({
        getItem: () =>
          '{"blurPercentage":0,"mode":"bing","overlayOpacity":0,"selectedCustomImageId":null,"version":3}',
      }),
    ).toEqual({
      blurPercentage: 0,
      mode: "bing",
      overlayOpacity: 0,
      selectedCustomImageId: null,
    });
    expect(
      readWorkbenchBackgroundPreference({
        getItem: () =>
          '{"blurPercentage":96,"mode":"bing","overlayOpacity":60,"selectedCustomImageId":null,"version":3}',
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
        mode: "custom",
        overlayOpacity: 45,
        selectedCustomImageId: "workspace-image",
      },
      { setItem },
    );

    expect(setItem).toHaveBeenCalledWith(
      "codexly.workbench-background-preference",
      '{"blurPercentage":57,"mode":"custom","overlayOpacity":45,"selectedCustomImageId":"workspace-image","version":3}',
    );
  });

  it("accepts only bounded raster image uploads", () => {
    expect(isSupportedCustomBackgroundImage({ size: 1024, type: "image/jpeg" })).toBe(true);
    expect(isSupportedCustomBackgroundImage({ size: 1024, type: "image/svg+xml" })).toBe(false);
    expect(isSupportedCustomBackgroundImage({ size: 21 * 1024 * 1024, type: "image/png" })).toBe(
      false,
    );
  });

  it("selects the next available image when the active image is removed", () => {
    const images = [
      { blob: new Blob(["first"]), createdAt: 1, id: "first", name: "first.png" },
      { blob: new Blob(["second"]), createdAt: 2, id: "second", name: "second.png" },
    ];

    expect(removeCustomBackgroundFromDraft(images, "first", "first")).toEqual({
      images: [images[1]],
      selectedCustomImageId: "second",
    });
    expect(removeCustomBackgroundFromDraft(images, "first", "second")).toEqual({
      images: [images[1]],
      selectedCustomImageId: "second",
    });
  });
});
