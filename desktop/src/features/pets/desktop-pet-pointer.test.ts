import { describe, expect, it, vi } from "vitest";

import { releaseDesktopPetPointerCapture } from "./desktop-pet-pointer.js";

describe("releaseDesktopPetPointerCapture", () => {
  it("releases WebView pointer routing before native drag starts", () => {
    const releasePointerCapture = vi.fn();

    releaseDesktopPetPointerCapture(
      {
        hasPointerCapture: () => true,
        releasePointerCapture,
      },
      7,
    );

    expect(releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it("does not release a pointer that is not captured", () => {
    const releasePointerCapture = vi.fn();

    releaseDesktopPetPointerCapture(
      {
        hasPointerCapture: () => false,
        releasePointerCapture,
      },
      7,
    );

    expect(releasePointerCapture).not.toHaveBeenCalled();
  });
});
