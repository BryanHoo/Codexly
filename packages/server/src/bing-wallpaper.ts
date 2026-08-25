const BING_ORIGIN = "https://www.bing.com";
const BING_METADATA_URL = `${BING_ORIGIN}/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN`;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024;

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

type BodyReaderResult =
  Readonly<{ done: false; value: Uint8Array }> | Readonly<{ done: true; value?: undefined }>;

type BodyReader = Readonly<{
  cancel: () => Promise<void>;
  read: () => Promise<BodyReaderResult>;
}>;

export type BingWallpaper = Readonly<{
  body: Buffer;
  contentType: "image/jpeg";
}>;

type BingWallpaperService = Readonly<{
  read: (day: string) => Promise<BingWallpaper>;
}>;

function fetchWithGlobal(input: string, init: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
  label: string,
): Promise<Buffer> {
  if (!response.ok || response.body === null) {
    throw new Error(`Bing wallpaper ${label} request failed`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`Bing wallpaper ${label} response is too large`);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const reader = response.body.getReader() as unknown as BodyReader;
  let result = await reader.read();
  while (!result.done) {
    const chunk = result.value;
    totalBytes += chunk.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new Error(`Bing wallpaper ${label} response is too large`);
    }
    chunks.push(Buffer.from(chunk));
    result = await reader.read();
  }
  return Buffer.concat(chunks, totalBytes);
}

function readImageUrl(metadata: Buffer): string {
  let value: unknown;
  try {
    value = JSON.parse(metadata.toString("utf8")) as unknown;
  } catch {
    throw new Error("Bing wallpaper returned invalid metadata");
  }
  const images: unknown = isRecord(value) ? value["images"] : null;
  const image = Array.isArray(images) ? (images[0] as unknown) : null;
  const path: unknown = isRecord(image) ? image["url"] : null;
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error("Bing wallpaper returned an invalid image URL");
  }
  const url = new URL(path, BING_ORIGIN);
  if (url.origin !== BING_ORIGIN || url.pathname !== "/th") {
    throw new Error("Bing wallpaper returned an invalid image URL");
  }
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadWallpaper(fetcher: Fetcher): Promise<BingWallpaper> {
  const metadataResponse = await fetcher(BING_METADATA_URL, {
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!metadataResponse.headers.get("content-type")?.startsWith("application/json")) {
    throw new Error("Bing wallpaper returned invalid metadata content type");
  }
  const metadata = await readBoundedBody(metadataResponse, MAX_METADATA_BYTES, "metadata");
  const imageUrl = readImageUrl(metadata);

  const imageResponse = await fetcher(imageUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!imageResponse.headers.get("content-type")?.startsWith("image/jpeg")) {
    throw new Error("Bing wallpaper returned invalid image content type");
  }
  const body = await readBoundedBody(imageResponse, MAX_WALLPAPER_BYTES, "image");
  if (body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
    throw new Error("Bing wallpaper returned invalid JPEG content");
  }
  return { body, contentType: "image/jpeg" };
}

export function createBingWallpaperService({
  fetcher = fetchWithGlobal,
}: Readonly<{ fetcher?: Fetcher }> = {}): BingWallpaperService {
  let cached: Readonly<{ day: string; wallpaper: BingWallpaper }> | null = null;
  let pending: Readonly<{ day: string; promise: Promise<BingWallpaper> }> | null = null;
  let loadGeneration = 0;

  return {
    read(day) {
      if (cached?.day === day) return Promise.resolve(cached.wallpaper);
      if (pending?.day === day) return pending.promise;

      const generation = ++loadGeneration;
      const promise = loadWallpaper(fetcher).then((wallpaper) => {
        // 跨日请求竞态中只允许最新日期更新唯一缓存。
        if (generation === loadGeneration) cached = { day, wallpaper };
        return wallpaper;
      });
      pending = { day, promise };
      const clearPending = () => {
        if (pending?.promise === promise) pending = null;
      };
      // 同时消费成功和失败分支，避免缓存清理创建未处理的派生拒绝。
      void promise.then(clearPending, clearPending);
      return promise;
    },
  };
}
