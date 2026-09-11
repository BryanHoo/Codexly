import { Type, type Static } from "@sinclair/typebox";

export const BingWallpaperSchema = Type.Object(
  {
    day: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
    title: Type.String(),
    copyright: Type.String(),
  },
  { additionalProperties: false },
);
export const BingWallpaperCatalogSchema = Type.Array(BingWallpaperSchema);
export type BingWallpaperInfo = Static<typeof BingWallpaperSchema>;
