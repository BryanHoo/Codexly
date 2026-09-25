import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildNativeAssetUrl, listNativeCustomBackgrounds, readNativeCustomBackground } =
  vi.hoisted(() => ({
    buildNativeAssetUrl: vi.fn((path: string) => `asset://localhost${path}`),
    listNativeCustomBackgrounds: vi.fn(),
    readNativeCustomBackground: vi.fn(),
  }));

vi.mock("../../platform/tauri/app-storage.js", () => ({
  appPreferenceStorage: {},
  listNativeCustomBackgrounds,
  readNativeCustomBackground,
  updateNativeCustomBackgrounds: vi.fn(),
}));
vi.mock("../../platform/native-asset-url.js", () => ({ buildNativeAssetUrl }));

import {
  readCustomBackgroundImages,
  readCustomBackgroundImageSource,
  readWorkbenchBackgroundPreference,
  DEFAULT_WORKBENCH_BACKGROUND,
} from "./workbench-background-preference.js";

describe("custom background assets", () => {
  it("restores a pinned Bing day instead of switching back to today's wallpaper", () => {
    const preference = { ...DEFAULT_WORKBENCH_BACKGROUND, mode: "bing", selectedBingDay: "2026-09-01" };
    expect(readWorkbenchBackgroundPreference({ getItem: () => JSON.stringify({ ...preference, version: 3 }) })).toEqual(preference);
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses controlled asset URLs for stored image previews", async () => {
    listNativeCustomBackgrounds.mockResolvedValue([
      {
        assetPath: "/app-data/backgrounds/custom/background-1",
        createdAt: 42,
        id: "background-1",
        mediaType: "image/png",
        name: "first.png",
      },
    ]);

    await expect(readCustomBackgroundImages()).resolves.toEqual([
      {
        assetUrl: "asset://localhost/app-data/backgrounds/custom/background-1",
        blob: null,
        createdAt: 42,
        id: "background-1",
        name: "first.png",
      },
    ]);
    expect(buildNativeAssetUrl).toHaveBeenCalledWith(
      "/app-data/backgrounds/custom/background-1",
    );
    expect(readNativeCustomBackground).not.toHaveBeenCalled();
  });

  it("resolves the selected stored image without reading its bytes", async () => {
    listNativeCustomBackgrounds.mockResolvedValue([
      {
        assetPath: "/app-data/backgrounds/custom/background-2",
        createdAt: 43,
        id: "background-2",
        mediaType: "image/webp",
        name: "second.webp",
      },
    ]);

    await expect(readCustomBackgroundImageSource("background-2")).resolves.toBe(
      "asset://localhost/app-data/backgrounds/custom/background-2",
    );
    expect(readNativeCustomBackground).not.toHaveBeenCalled();
  });
});
