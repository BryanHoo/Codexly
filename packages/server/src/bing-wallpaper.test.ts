import { describe, expect, it, vi } from "vitest";

import { createBingWallpaperService } from "./bing-wallpaper.js";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

function metadataResponse(url = "/th?id=OHR.Workbench_1920x1080.jpg&pid=hp"): Response {
  return new Response(JSON.stringify({ images: [{ url }] }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function imageResponse(body: Uint8Array = jpeg): Response {
  return new Response(body, {
    headers: { "content-length": String(body.byteLength), "content-type": "image/jpeg" },
    status: 200,
  });
}

describe("Bing wallpaper service", () => {
  it("loads and caches one bounded Bing image for the requested day", async () => {
    const fetcher = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(metadataResponse())
      .mockResolvedValueOnce(imageResponse());
    const service = createBingWallpaperService({ fetcher });

    const first = await service.read("2026-08-25");
    const repeated = await service.read("2026-08-25");

    expect(first.contentType).toBe("image/jpeg");
    expect(first.body).toEqual(Buffer.from(jpeg));
    expect(repeated).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://www.bing.com/th?id=OHR.Workbench_1920x1080.jpg&pid=hp",
    );
  });

  it("rejects external image paths and oversized responses", async () => {
    const externalFetcher = vi
      .fn()
      .mockResolvedValue(metadataResponse("https://example.com/a.jpg"));
    await expect(
      createBingWallpaperService({ fetcher: externalFetcher }).read("2026-08-25"),
    ).rejects.toThrow("invalid image URL");

    const oversizedFetcher = vi
      .fn()
      .mockResolvedValueOnce(metadataResponse())
      .mockResolvedValueOnce(
        new Response(jpeg, {
          headers: { "content-length": String(21 * 1024 * 1024), "content-type": "image/jpeg" },
        }),
      );
    await expect(
      createBingWallpaperService({ fetcher: oversizedFetcher }).read("2026-08-25"),
    ).rejects.toThrow("too large");
  });
});
