import { queryOptions } from "@tanstack/react-query";

export function bingWallpaperUrl(day: string | null, thumbnail = false): string {
  return day === null
    ? `/v1/workbench-background/bing?day=${new Date().toLocaleDateString("en-CA")}`
    : `/v1/workbench-background/bing/image?day=${encodeURIComponent(day)}&thumbnail=${String(thumbnail)}`;
}
export function bingImageQuery(day: string | null | undefined, thumbnail: boolean) {
  return queryOptions({
    queryKey: ["bing-wallpaper", day, thumbnail],
    queryFn: () => Promise.resolve(bingWallpaperUrl(day ?? null, thumbnail)),
    enabled: day !== undefined,
    staleTime: day === null ? 60 * 60_000 : Infinity,
  });
}
