import { queryOptions } from "@tanstack/react-query";
import { buildNativeAssetUrl } from "../../../platform/native-asset-url.js";
import { nativeClient } from "../../projects/project-queries.js";

export function bingImageQuery(day: string | null | undefined, thumbnail: boolean) {
  return queryOptions({
    queryKey: ["bing-wallpaper", day, thumbnail],
    queryFn: async () => buildNativeAssetUrl((await nativeClient.getWorkbenchBackground(day ?? undefined, thumbnail)).assetPath),
    enabled: day !== undefined,
    // 固定日期永久复用；每日背景定期刷新，列表仅在打开图库时查询。
    staleTime: day === null ? 60 * 60_000 : Infinity,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}
