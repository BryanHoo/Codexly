export type BingWallpaper = Readonly<{
  day: string;
  title: string;
  copyright: string;
}>;

export type WorkbenchBackgroundResponse = Readonly<{ assetPath: string }>;
export type DownloadWorkbenchBackgroundResponse =
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "saved"; fileName: string }>;
