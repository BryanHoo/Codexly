import type { WorkbenchPetAnimation } from "@codexly/protocol";

type PetAnimations = Readonly<Record<string, WorkbenchPetAnimation>>;

function isUsableAnimation(animation: WorkbenchPetAnimation | undefined): boolean {
  return animation !== undefined && animation.frames.length > 0;
}

export function resolvePetAnimation(
  animations: PetAnimations,
  requestedName: string,
): WorkbenchPetAnimation | undefined {
  const visited = new Set<string>();
  let name = requestedName;
  while (!visited.has(name)) {
    visited.add(name);
    const animation = animations[name];
    if (animation !== undefined && isUsableAnimation(animation)) return animation;
    if (animation !== undefined) {
      name = animation.fallback;
    } else if (name !== "idle") {
      name = "idle";
    } else {
      return undefined;
    }
  }
  return undefined;
}

type PetAnimationControllerOptions = Readonly<{
  animations: PetAnimations;
  onFrame: (spriteIndex: number) => void;
}>;

export class PetAnimationController {
  readonly #animations: PetAnimations;
  readonly #onFrame: (spriteIndex: number) => void;
  #animationName = "idle";
  #disposed = false;
  #generation = 0;
  #reducedMotion = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #visible = true;

  public constructor(options: PetAnimationControllerOptions) {
    this.#animations = options.animations;
    this.#onFrame = options.onFrame;
  }

  public play(animationName: string): void {
    this.#animationName = animationName;
    this.#restart();
  }

  public setReducedMotion(reducedMotion: boolean): void {
    if (this.#reducedMotion === reducedMotion) return;
    this.#reducedMotion = reducedMotion;
    this.#restart();
  }

  public setVisible(visible: boolean): void {
    if (this.#visible === visible) return;
    this.#visible = visible;
    this.#restart();
  }

  public dispose(): void {
    this.#disposed = true;
    this.#generation += 1;
    this.#cancelTimer();
  }

  #cancelTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #restart(): void {
    this.#generation += 1;
    this.#cancelTimer();
    if (this.#disposed || !this.#visible) return;
    const animation = resolvePetAnimation(this.#animations, this.#animationName);
    if (animation === undefined) return;
    this.#showFrame(animation, 0, this.#generation);
  }

  #showFrame(animation: WorkbenchPetAnimation, frameIndex: number, generation: number): void {
    if (generation !== this.#generation || this.#disposed || !this.#visible) return;
    const frame = animation.frames[frameIndex];
    if (frame === undefined) return;
    this.#onFrame(frame.spriteIndex);
    if (this.#reducedMotion) return;

    const nextIndex = frameIndex + 1;
    const loopIndex = animation.loopStart ?? -1;
    if (nextIndex >= animation.frames.length && loopIndex < 0) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#showFrame(
        animation,
        nextIndex < animation.frames.length ? nextIndex : loopIndex,
        generation,
      );
    }, frame.durationMs);
  }
}
