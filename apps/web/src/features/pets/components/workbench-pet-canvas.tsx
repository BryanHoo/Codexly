import { buildWorkbenchPetAssetUrl } from "@codexly/client";
import type { WorkbenchPetDescriptor } from "@codexly/protocol";
import { useEffect, useRef, useState } from "react";

import { PetAnimationController } from "../pet-animation-controller.js";
import { drawPetFrame, loadPetBitmap } from "../pet-renderer.js";

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
  pet,
}: Readonly<{ animationName: string; pet: WorkbenchPetDescriptor }>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [fallback, setFallback] = useState(false);
  const reducedMotion = useReducedMotion();
  const assetUrl = buildWorkbenchPetAssetUrl(pet.assetId);

  useEffect(() => {
    const abortController = new AbortController();
    let active = true;
    setBitmap(null);
    setFallback(false);
    if (typeof createImageBitmap !== "function") {
      setFallback(true);
      return () => {
        abortController.abort();
      };
    }
    void loadPetBitmap(assetUrl, abortController.signal)
      .then((nextBitmap) => {
        if (active) {
          setBitmap(nextBitmap);
        } else {
          nextBitmap.close();
        }
      })
      .catch(() => {
        if (active && !abortController.signal.aborted) setFallback(true);
      });
    return () => {
      active = false;
      abortController.abort();
    };
  }, [assetUrl]);

  useEffect(
    () => () => {
      bitmap?.close();
    },
    [bitmap],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || bitmap === null) return;
    let currentFrame = 0;
    const draw = (spriteIndex: number) => {
      currentFrame = spriteIndex;
      try {
        drawPetFrame(canvas, bitmap, pet.frame, spriteIndex);
      } catch {
        setFallback(true);
      }
    };
    const controller = new PetAnimationController({ animations: pet.animations, onFrame: draw });
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
  }, [animationName, bitmap, pet.animations, pet.frame, reducedMotion]);

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
