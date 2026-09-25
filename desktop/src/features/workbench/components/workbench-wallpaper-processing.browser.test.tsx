import { describe, expect, it } from "vitest";
import { drawPreprocessedWallpaper, loadWallpaperImage } from "./workbench-wallpaper-processing.js";

describe("wallpaper pixel processing", () => {
  it("blurs the actual pixels and restores the sharp image at zero", async () => {
    const fixture = document.createElement("canvas");
    fixture.width = 200; fixture.height = 100;
    const source = fixture.getContext("2d")!;
    source.fillStyle = "black"; source.fillRect(0, 0, 100, 100);
    source.fillStyle = "white"; source.fillRect(100, 0, 100, 100);
    const image = await loadWallpaperImage(fixture.toDataURL(), new AbortController().signal);
    const canvas = document.createElement("canvas");
    const size = { width: 200, height: 100 };
    await drawPreprocessedWallpaper(canvas, image, size, 0, 1);
    await drawPreprocessedWallpaper(canvas, image, size, 10, 1);
    const pixels = canvas.getContext("2d")!;
    // 直接读取黑白分界两侧像素，避免只验证不受 WebKit 支持的 filter 属性赋值。
    expect(pixels.getImageData(95, 50, 1, 1).data[0]).toBeGreaterThan(10);
    expect(pixels.getImageData(105, 50, 1, 1).data[0]).toBeLessThan(245);
    expect(pixels.getImageData(0, 0, 1, 1).data[3]).toBe(255);
    await drawPreprocessedWallpaper(canvas, image, size, 0, 1);
    expect(pixels.getImageData(95, 50, 1, 1).data[0]).toBe(0);
    expect(pixels.getImageData(105, 50, 1, 1).data[0]).toBe(255);
    await drawPreprocessedWallpaper(canvas, image, size, 10, 1);
    expect(pixels.getImageData(95, 50, 1, 1).data[0]).toBeGreaterThan(10);
    const controller = new AbortController();
    controller.abort();
    expect(await drawPreprocessedWallpaper(canvas, image, size, 0, 1, controller.signal)).toBe(false);
    expect(pixels.getImageData(95, 50, 1, 1).data[0]).toBeGreaterThan(10);
  });
});
