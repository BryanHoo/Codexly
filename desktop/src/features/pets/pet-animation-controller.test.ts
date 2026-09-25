import { describe, expect, it } from "vitest";

import { resolvePetFrameDuration } from "./pet-animation-controller.js";

describe("pet animation frame rate", () => {
  it("caps idle animation at 10 FPS", () => {
    expect(resolvePetFrameDuration(16, 10)).toBe(100);
  });

  it("caps active animation at 25 FPS", () => {
    expect(resolvePetFrameDuration(16, 25)).toBe(40);
  });

  it("preserves intentional frame pauses and uncapped previews", () => {
    expect(resolvePetFrameDuration(150, 25)).toBe(150);
    expect(resolvePetFrameDuration(16)).toBe(16);
  });
});
