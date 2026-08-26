import type { WorkbenchPetAnimation } from "@codexly/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PetAnimationController, resolvePetAnimation } from "./pet-animation-controller.js";

const animations: Readonly<Record<string, WorkbenchPetAnimation>> = {
  idle: {
    fallback: "idle",
    frames: [
      { durationMs: 100, spriteIndex: 0 },
      { durationMs: 200, spriteIndex: 1 },
    ],
    loopStart: 0,
  },
  waiting: {
    fallback: "idle",
    frames: [{ durationMs: 300, spriteIndex: 48 }],
    loopStart: null,
  },
};

describe("PetAnimationController", () => {
  afterEach(() => vi.useRealTimers());

  it("按每帧时长调度并从 loopStart 继续循环", () => {
    vi.useFakeTimers();
    const onFrame = vi.fn();
    const controller = new PetAnimationController({ animations, onFrame });

    controller.play("idle");
    expect(onFrame).toHaveBeenLastCalledWith(0);
    vi.advanceTimersByTime(100);
    expect(onFrame).toHaveBeenLastCalledWith(1);
    vi.advanceTimersByTime(200);
    expect(onFrame).toHaveBeenLastCalledWith(0);
    expect(vi.getTimerCount()).toBe(1);

    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("沿 fallback 回退到有效动画并阻止循环引用", () => {
    expect(resolvePetAnimation(animations, "missing")).toBe(animations["idle"]);
    expect(
      resolvePetAnimation(
        {
          broken: { fallback: "other", frames: [], loopStart: null },
          other: { fallback: "broken", frames: [], loopStart: null },
        },
        "broken",
      ),
    ).toBeUndefined();
  });

  it("后台或减少动态效果时固定第一帧且不保留 Timer", () => {
    vi.useFakeTimers();
    const onFrame = vi.fn();
    const controller = new PetAnimationController({ animations, onFrame });

    controller.setReducedMotion(true);
    controller.play("idle");
    expect(onFrame).toHaveBeenLastCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);

    controller.setReducedMotion(false);
    controller.setVisible(false);
    expect(vi.getTimerCount()).toBe(0);
    controller.setVisible(true);
    expect(onFrame).toHaveBeenLastCalledWith(0);
    expect(vi.getTimerCount()).toBe(1);
  });
});
