import { buildNativeAssetUrl } from "@/platform/native-asset-url.js";
import type { WorkbenchPetDescriptor } from "@/protocol/index.js";
import { useEffect, useRef, useState } from "react";

import { PetAnimationController } from "../pet-animation-controller.js";
import { drawPetFrame, loadPetImage } from "../pet-renderer.js";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReduced(query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, []);
  return reduced;
}

export function WorkbenchPetCanvas({
  animationName,
  maximumFps,
  onReady,
  pet,
}: Readonly<{
  animationName: string;
  maximumFps?: number;
  onReady?: () => void;
  pet: WorkbenchPetDescriptor;
}>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fallback, setFallback] = useState(false);
  const reducedMotion = useReducedMotion();
  const assetUrl = buildNativeAssetUrl(pet.assetPath ?? pet.assetId);
  const readyRef = useRef(false);

  useEffect(() => {
    const abortController = new AbortController();
    let active = true;
    readyRef.current = false;
    setImage(null);
    setFallback(false);
    if (typeof Image !== "function") {
      setFallback(true);
      return () => {
        abortController.abort();
      };
    }
    void loadPetImage(assetUrl, abortController.signal)
      .then((nextImage) => {
        if (active) setImage(nextImage);
      })
      .catch(() => {
        if (active && !abortController.signal.aborted) setFallback(true);
      });
    return () => {
      active = false;
      abortController.abort();
    };
  }, [assetUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || image === null) return;
    let currentFrame = 0;
    const draw = (spriteIndex: number) => {
      currentFrame = spriteIndex;
      try {
        drawPetFrame(canvas, image, pet.frame, spriteIndex);
        if (!readyRef.current) {
          readyRef.current = true;
          onReady?.();
        }
      } catch {
        setFallback(true);
      }
    };
    const controller = new PetAnimationController({
      animations: pet.animations,
      maximumFps,
      onFrame: draw,
    });
    controller.setReducedMotion(reducedMotion);
    controller.setVisible(document.visibilityState === "visible");
    controller.play(animationName);

    // 尺寸只在 ResizeObserver 通知时读取，动画帧本身不会触发布局测量。
    const observer = new ResizeObserver(() => {
      draw(currentFrame);
    });
    observer.observe(canvas);
    const handleVisibility = () => {
      controller.setVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      controller.dispose();
    };
  }, [animationName, image, maximumFps, onReady, pet.animations, pet.frame, reducedMotion]);

  useEffect(() => {
    // 隐藏的原生窗口不会推进动画，资源提交后即可显示并由 visibilitychange 启动首帧。
    if ((image !== null || fallback) && !readyRef.current) {
      readyRef.current = true;
      onReady?.();
    }
  }, [fallback, image, onReady]);

  if (fallback) {
    return (
      <span
        aria-hidden="true"
        className="workbench-pet-static-fallback"
        style={{
          backgroundImage: `url(${assetUrl})`,
          backgroundSize: `${String(pet.frame.columns * 100)}% ${String(pet.frame.rows * 100)}%`,
        }}
      />
    );
  }
  return <canvas aria-hidden="true" className="workbench-pet-canvas" ref={canvasRef} />;
}
