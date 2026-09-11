import type { BingWallpaperInfo } from "@codexly/protocol";
import { readBoundedBody } from "./bing-wallpaper.js";

type Entry = BingWallpaperInfo & Readonly<{ url: string }>;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const origin = "https://www.bing.com";
const metadataUrl = `${origin}/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN`;

function parseCatalog(value: unknown): Entry[] {
  if (!value || typeof value !== "object" || !("images" in value) || !Array.isArray(value.images))
    throw new Error("Invalid Bing wallpaper catalog");
  return value.images.slice(0, 9).map((item: unknown) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("startdate" in item) ||
      typeof item.startdate !== "string" ||
      !/^\d{8}$/u.test(item.startdate) ||
      !("url" in item) ||
      typeof item.url !== "string" ||
      !item.url.startsWith("/")
    )
      throw new Error("Invalid Bing wallpaper entry");
    const url = new URL(item.url, origin);
    // 浏览器只提交日期；图片目标必须来自已校验的 Bing 元数据，禁止任意 URL 代理。
    if (url.origin !== origin || url.pathname !== "/th")
      throw new Error("Invalid Bing wallpaper URL");
    return {
      day: `${item.startdate.slice(0, 4)}-${item.startdate.slice(4, 6)}-${item.startdate.slice(6)}`,
      title: "title" in item && typeof item.title === "string" ? item.title : "",
      copyright: "copyright" in item && typeof item.copyright === "string" ? item.copyright : "",
      url: url.toString(),
    };
  });
}

export function createBingWallpaperCatalog(fetcher: Fetcher = (url, init) => fetch(url, init)) {
  let cached: Entry[] = [];
  let expires = 0;
  let pending: Promise<Entry[]> | undefined;
  const images = new Map<string, Promise<Buffer>>();
  const readEntries = (): Promise<Entry[]> => {
    if (Date.now() < expires) return Promise.resolve(cached);
    if (pending) return pending;
    pending = (async () => {
      const response = await fetcher(metadataUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.headers.get("content-type")?.startsWith("application/json"))
        throw new Error("Invalid Bing metadata content type");
      const entries = parseCatalog(
        JSON.parse(
          (await readBoundedBody(response, 64 * 1024, "catalog")).toString("utf8"),
        ) as unknown,
      );
      cached = entries;
      expires = Date.now() + 60 * 60_000;
      images.clear();
      return entries;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  return {
    async list(): Promise<BingWallpaperInfo[]> {
      return (await readEntries()).map(({ day, title, copyright }) => ({ day, title, copyright }));
    },
    async read(day: string, thumbnail: boolean): Promise<Buffer> {
      const entries = await readEntries();
      const entry = entries.find((item) => item.day === day);
      if (!entry)
        throw Object.assign(new Error("Bing wallpaper is no longer available"), {
          statusCode: 404,
        });
      const key = `${day}:${String(thumbnail)}`;
      const existing = images.get(key);
      if (existing) return existing;
      const promise = (async () => {
        const url = new URL(entry.url);
        if (thumbnail) {
          url.searchParams.set("w", "480");
          url.searchParams.set("h", "270");
        }
        const response = await fetcher(url.toString(), {
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.headers.get("content-type")?.startsWith("image/jpeg"))
          throw new Error("Invalid Bing image content type");
        const body = await readBoundedBody(
          response,
          thumbnail ? 2 * 1024 * 1024 : 20 * 1024 * 1024,
          "image",
        );
        if (body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff)
          throw new Error("Invalid Bing JPEG content");
        return body;
      })();
      // 只缓存缩略图，原图完成后释放，避免图库长期占用大量内存。
      images.set(key, promise);
      void promise.then(
        () => {
          if (!thumbnail) images.delete(key);
        },
        () => {
          images.delete(key);
        },
      );
      return promise;
    },
  };
}
