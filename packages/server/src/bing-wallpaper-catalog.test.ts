import { describe, expect, it, vi } from "vitest";
import { createBingWallpaperCatalog } from "./bing-wallpaper-catalog.js";

describe("Bing wallpaper catalog", () => {
  it("缓存目录和缩略图，仅允许选择目录中的日期", async () => {
    const fetcher = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            images: [
              {
                startdate: "20260911",
                title: "山谷",
                copyright: "Bing",
                url: "/th?id=OHR.Valley.jpg",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
          headers: { "content-type": "image/jpeg" },
        }),
      );
    const catalog = createBingWallpaperCatalog(fetcher);
    await expect(catalog.list()).resolves.toEqual([
      { day: "2026-09-11", title: "山谷", copyright: "Bing" },
    ]);
    await catalog.read("2026-09-11", true);
    await catalog.read("2026-09-11", true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://www.bing.com/th?id=OHR.Valley.jpg&w=480&h=270",
    );
    await expect(catalog.read("2020-01-01", false)).rejects.toThrow("no longer available");
  });
  it("拒绝外部图片地址", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ images: [{ startdate: "20260911", url: "//example.com/th" }] }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await expect(createBingWallpaperCatalog(fetcher).list()).rejects.toThrow(
      "Invalid Bing wallpaper URL",
    );
  });
});
