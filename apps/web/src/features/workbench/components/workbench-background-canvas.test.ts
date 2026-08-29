import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkbenchBackgroundRenderKey,
  drawWorkbenchBackground,
  getCanvasPhysicalSize,
  getCoverDrawRect,
} from "./workbench-background-canvas.js";

describe("workbench background canvas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses physical pixels and redraws only when preprocessing inputs change", () => {
    expect(getCanvasPhysicalSize(801, 601, 2)).toEqual({ height: 1202, width: 1602 });

    const input = {
      blurRadius: 12,
      devicePixelRatio: 2,
      height: 601,
      source: "/wallpaper.jpg",
      width: 801,
    };
    expect(createWorkbenchBackgroundRenderKey(input)).toBe(
      createWorkbenchBackgroundRenderKey({ ...input }),
    );
    expect(createWorkbenchBackgroundRenderKey(input)).not.toBe(
      createWorkbenchBackgroundRenderKey({ ...input, devicePixelRatio: 3 }),
    );
    expect(createWorkbenchBackgroundRenderKey(input)).not.toBe(
      createWorkbenchBackgroundRenderKey({ ...input, blurRadius: 13 }),
    );
  });

  it("covers the target and expands the draw area so canvas blur has no transparent edge", () => {
    expect(getCoverDrawRect(1920, 1080, 800, 800, 20)).toEqual({
      height: 840,
      width: 1493.3333333333333,
      x: -346.66666666666663,
      y: -20,
    });
  });

  it("decodes and draws the blurred image directly into the physical backing store", async () => {
    class DecodedImage {
      decoding = "auto";
      naturalHeight = 500;
      naturalWidth = 1000;
      src = "";
      decode = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal("Image", DecodedImage);
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      filter: "none",
      restore: vi.fn(),
      save: vi.fn(),
    };
    const canvas = {
      getContext: vi.fn().mockReturnValue(context),
      height: 0,
      width: 0,
    } as unknown as HTMLCanvasElement;

    await drawWorkbenchBackground(canvas, {
      blurRadius: 10,
      devicePixelRatio: 2,
      height: 600,
      source: "/wallpaper.jpg",
      width: 800,
    });

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(context.filter).toBe("blur(20px)");
    expect(context.drawImage).toHaveBeenCalledOnce();
  });
});
