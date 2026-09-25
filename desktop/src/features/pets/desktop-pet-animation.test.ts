import { describe, expect, it } from "vitest";

import {
  desktopPetDragPosition,
  dragAnimation,
  introDuration,
  isDesktopPetDragPointerActive,
} from "./desktop-pet-animation.js";

describe("desktop pet drag animation", () => {
  it("uses the original four-pixel horizontal direction mapping", () => {
    expect(dragAnimation(100, 96)).toBe("running-left");
    expect(dragAnimation(100, 104)).toBe("running-right");
    expect(dragAnimation(100, 103)).toBeNull();
  });

  it("plays only the non-looping jumping intro before returning to activity", () => {
    expect(
      introDuration({
        fallback: "idle",
        frames: [
          { durationMs: 120, spriteIndex: 1 },
          { durationMs: 180, spriteIndex: 2 },
          { durationMs: 240, spriteIndex: 3 },
        ],
        loopStart: 2,
      }),
    ).toBe(300);
  });

  it("maps Codexly pointer movement to desktop physical coordinates", () => {
    expect(
      desktopPetDragPosition(
        { x: 300, y: 500 },
        { x: 100, y: 200 },
        { x: 104, y: 194 },
        2,
      ),
    ).toEqual({ x: 308, y: 488 });
  });

  it("ends dragging when WebKit misses pointerup after moving the native window", () => {
    expect(isDesktopPetDragPointerActive(1)).toBe(true);
    expect(isDesktopPetDragPointerActive(0)).toBe(false);
    expect(isDesktopPetDragPointerActive(2)).toBe(false);
  });
});
