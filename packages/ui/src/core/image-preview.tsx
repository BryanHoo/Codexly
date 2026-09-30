import { LoaderCircle } from "lucide-react";
import { lazy, Suspense } from "react";

import type { ImagePreviewProps } from "./image-preview-types.js";

export type { ImagePreviewLabels, ImagePreviewProps } from "./image-preview-types.js";

// 手势引擎仅在预览挂载时加载，消息缩略图和工作台首屏不承担该依赖开销。
const LazyImagePreviewContent = lazy(() =>
  import("./image-preview-content.js").then((module) => ({ default: module.ImagePreviewContent })),
);

export function ImagePreview(props: ImagePreviewProps) {
  return (
    <Suspense
      fallback={
        <div className="grid size-full min-h-0 place-items-center">
          <LoaderCircle
            aria-label={props.labels.loading}
            className="size-5 motion-safe:animate-spin text-muted-foreground"
            role="status"
          />
        </div>
      }
    >
      {/* 更换资源时丢弃旧变换和加载状态，避免沿用上一张图片的放大位置。 */}
      <LazyImagePreviewContent key={props.src} {...props} />
    </Suspense>
  );
}
