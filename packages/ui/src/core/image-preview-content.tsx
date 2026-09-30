import { LoaderCircle, Maximize, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";

import { Button } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

import type { ImagePreviewProps } from "./image-preview-types.js";

const MIN_SCALE = 0.1;
const MAX_SCALE = 64;
const FULL_SIZE = { width: "100%", height: "100%" };

export function ImagePreviewContent({ alt, labels, src }: ImagePreviewProps) {
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const scaleRef = useRef<HTMLOutputElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // 侧栏、窗口或屏幕方向改变时重新适配；观察未变换的容器，避免缩放触发循环。
    const observer = new ResizeObserver(() => {
      void transformRef.current?.resetTransform(0);
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
    };
  }, []);

  const actualSize = () => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image?.naturalWidth || !image.naturalHeight) return;
    const fitScale = Math.min(
      viewport.clientWidth / image.naturalWidth,
      viewport.clientHeight / image.naturalHeight,
    );
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, 1 / fitScale));
    void transformRef.current?.centerView(scale, 0);
  };

  const actions = [
    {
      label: labels.zoomOut,
      Icon: ZoomOut,
      run: () => {
        void transformRef.current?.zoomOut(0.25, 0);
      },
    },
    {
      label: labels.zoomIn,
      Icon: ZoomIn,
      run: () => {
        void transformRef.current?.zoomIn(0.25, 0);
      },
    },
    {
      label: labels.fit,
      Icon: Maximize,
      run: () => {
        void transformRef.current?.resetTransform(0);
      },
    },
    { label: labels.actualSize, Icon: Scan, run: actualSize },
  ];

  return (
    <div
      className="grid size-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-content"
      data-image-preview=""
    >
      <div className="relative min-h-0 min-w-0 overflow-hidden" ref={viewportRef}>
        <TransformWrapper
          autoAlignment={{ disabled: true }}
          disabled={status !== "ready"}
          doubleClick={{ disabled: true }}
          keyboard={{ disabled: false, animationTime: 0 }}
          limitToBounds={false}
          maxScale={MAX_SCALE}
          minScale={MIN_SCALE}
          onTransform={(_ref, state) => {
            // 高频手势只更新变换和读数，不触发 React 重渲染或重新读取图片。
            if (scaleRef.current)
              scaleRef.current.textContent = `${String(Math.round(state.scale * 100))}%`;
          }}
          panning={{ velocityDisabled: true, allowRightClickPan: false }}
          ref={transformRef}
          smooth={false}
          velocityAnimation={{ disabled: true }}
          wheel={{ step: 0.1 }}
          zoomAnimation={{ disabled: true }}
        >
          <TransformComponent
            contentStyle={FULL_SIZE}
            wrapperClass="touch-none select-none cursor-grab active:cursor-grabbing"
            wrapperProps={{
              onDoubleClick: () => {
                // 只处理鼠标双击，避免捏合后的下一次触摸被手势库误判为双击复位。
                if (status === "ready") void transformRef.current?.zoomIn(0.7, 0);
              },
            }}
            wrapperStyle={FULL_SIZE}
          >
            <img
              alt={alt}
              className="block size-full object-contain"
              decoding="async"
              draggable={false}
              onError={() => {
                setStatus("error");
              }}
              onLoad={() => {
                setStatus("ready");
              }}
              ref={imageRef}
              src={src}
              style={{ visibility: status === "error" ? "hidden" : "visible" }}
            />
          </TransformComponent>
        </TransformWrapper>
        {status === "ready" ? null : (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-body-small text-muted-foreground">
            {status === "error" ? (
              <span className="text-danger" role="alert">
                {labels.loadError}
              </span>
            ) : (
              <LoaderCircle
                aria-label={labels.loading}
                className="size-5 motion-safe:animate-spin"
                role="status"
              />
            )}
          </div>
        )}
      </div>
      <div className="flex h-9 shrink-0 items-center justify-center gap-1 border-t border-separator bg-raised px-2">
        {actions.map(({ label, Icon, run }) => (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <Button
                aria-label={label}
                disabled={status !== "ready"}
                onClick={run}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Icon aria-hidden="true" className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
        <output
          className="w-14 text-center text-caption tabular-nums text-muted-foreground"
          ref={scaleRef}
        >
          100%
        </output>
      </div>
    </div>
  );
}
