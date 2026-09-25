import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPetImage } from "./pet-renderer.js";

describe("desktop pet image loading", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads Tauri assets through an image element before Canvas rendering", async () => {
    class FakeImage {
      public decoding = "auto";
      public onerror: (() => void) | null = null;
      public onload: (() => void) | null = null;
      public source = "";

      public get src(): string {
        return this.source;
      }

      public set src(value: string) {
        this.source = value;
        queueMicrotask(() => {
          this.onload?.();
        });
      }
    }
    vi.stubGlobal("Image", FakeImage);

    const image = await loadPetImage("asset://localhost/pet.webp", new AbortController().signal);

    expect(image.src).toBe("asset://localhost/pet.webp");
    expect(image.decoding).toBe("async");
  });
});
