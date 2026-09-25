import { describe, expect, it, vi } from "vitest";

vi.mock("../../../platform/native-asset-url.js", () => ({
  buildNativeAssetUrl: (path: string) => `asset:${path}`,
}));

import {
  persistPromptAttachments,
  resolvePromptAttachment,
} from "./workbench-composer-contracts.js";

describe("resolvePromptAttachment", () => {
  it("preserves automatic image detail after a browser upload", async () => {
    const upload = vi.fn().mockResolvedValue({
      id: "/cache/photo.png",
      kind: "image",
      mediaType: "image/png",
      name: "photo.png",
      size: 12,
    });

    const resolved = await resolvePromptAttachment(
      {
        detail: "auto",
        file: new File(["image"], "photo.png", { type: "image/png" }),
        id: "browser-photo",
        kind: "image",
        mediaType: "image/png",
        name: "photo.png",
        previewUrl: "blob:photo",
        size: 5,
        source: "browser",
      },
      upload,
    );

    expect(resolved.detail).toBe("auto");
  });

  it("normalizes host images to automatic detail", async () => {
    const resolved = await resolvePromptAttachment(
      {
        attachment: {
          id: "/cache/photo.png",
          kind: "image",
          mediaType: "image/png",
          name: "photo.png",
          size: 12,
        },
        detail: "auto",
        id: "/cache/photo.png",
        kind: "image",
        mediaType: "image/png",
        name: "photo.png",
        previewUrl: "asset:photo",
        size: 12,
        source: "host",
      },
      vi.fn(),
    );

    expect(resolved.detail).toBe("auto");
  });

  it("converts browser files into persistent host draft attachments", async () => {
    const upload = vi.fn().mockResolvedValue({
      id: "/cache/photo.png",
      kind: "image",
      mediaType: "image/png",
      name: "photo.png",
      size: 12,
    });

    const persisted = await persistPromptAttachments(
      [
        {
          detail: "auto",
          file: new File(["image"], "photo.png", { type: "image/png" }),
          id: "browser-photo",
          kind: "image",
          mediaType: "image/png",
          name: "photo.png",
          previewUrl: "blob:photo",
          size: 5,
          source: "browser",
        },
      ],
      upload,
    );

    expect(persisted).toEqual([
      expect.objectContaining({
        attachment: expect.objectContaining({ id: "/cache/photo.png" }),
        id: "/cache/photo.png",
        previewUrl: expect.stringContaining("/cache/photo.png"),
        source: "host",
      }),
    ]);
  });
});
