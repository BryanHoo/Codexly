export const BACKGROUND_DETAIL_SUSPEND_DELAY_MS = 60_000;

type VisibilityTarget = Readonly<{
  visibilityState: DocumentVisibilityState;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
}>;

export type DetailViewUpdateGate = Readonly<{
  isSuspended: () => boolean;
  subscribe: (listener: () => void) => () => void;
}>;

type ApplicationSuspensionEffects = Readonly<{
  setAnimationsSuspended: (suspended: boolean) => void;
  setPollingActive: (active: boolean) => void;
}>;

export function installApplicationSuspensionEffects(
  gate: DetailViewUpdateGate,
  effects: ApplicationSuspensionEffects,
): () => void {
  const synchronize = () => {
    const suspended = gate.isSuspended();
    effects.setAnimationsSuspended(suspended);
    effects.setPollingActive(!suspended);
  };
  synchronize();
  const unsubscribe = gate.subscribe(synchronize);
  return unsubscribe;
}

export function runDetailViewInterval(
  gate: DetailViewUpdateGate,
  callback: () => void,
  intervalMs: number,
): () => void {
  let intervalId: ReturnType<typeof setInterval> | undefined;
  const stopInterval = () => {
    if (intervalId !== undefined) clearInterval(intervalId);
    intervalId = undefined;
  };
  const synchronize = (runImmediately: boolean) => {
    stopInterval();
    if (gate.isSuspended()) return;
    if (runImmediately) callback();
    intervalId = setInterval(callback, intervalMs);
  };
  synchronize(false);
  const unsubscribe = gate.subscribe(() => synchronize(true));
  return () => {
    unsubscribe();
    stopInterval();
  };
}

export class DelayedBackgroundSuspension implements DetailViewUpdateGate {
  readonly #listeners = new Set<() => void>();
  readonly #suspendDelayMs: number;
  readonly #target: VisibilityTarget;
  #disposed = false;
  #suspended = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    target: VisibilityTarget,
    suspendDelayMs = BACKGROUND_DETAIL_SUSPEND_DELAY_MS,
  ) {
    if (!Number.isFinite(suspendDelayMs) || suspendDelayMs < 0) {
      throw new RangeError("Background suspension delay must be a non-negative number");
    }
    this.#target = target;
    this.#suspendDelayMs = suspendDelayMs;
    this.#target.addEventListener("visibilitychange", this.#handleVisibilityChange);
    this.#handleVisibilityChange();
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearTimer();
    this.#listeners.clear();
    this.#target.removeEventListener("visibilitychange", this.#handleVisibilityChange);
  }

  public isSuspended(): boolean {
    return this.#suspended;
  }

  public subscribe(listener: () => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  readonly #handleVisibilityChange = (): void => {
    if (this.#disposed) return;
    if (this.#target.visibilityState === "visible") {
      this.#clearTimer();
      this.#setSuspended(false);
      return;
    }
    if (this.#suspended || this.#timer !== undefined) return;
    // 短暂切换不进入暂停态，避免反复清空和恢复详细视图流水线。
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#target.visibilityState !== "visible") this.#setSuspended(true);
    }, this.#suspendDelayMs);
  };

  #clearTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #setSuspended(suspended: boolean): void {
    if (this.#suspended === suspended) return;
    this.#suspended = suspended;
    for (const listener of this.#listeners) listener();
  }
}

const alwaysActiveGate: DetailViewUpdateGate = {
  isSuspended: () => false,
  subscribe: () => () => undefined,
};

let applicationGate: DetailViewUpdateGate | undefined;

export function getApplicationDetailViewUpdateGate(): DetailViewUpdateGate {
  applicationGate ??=
    typeof document === "undefined"
      ? alwaysActiveGate
      : new DelayedBackgroundSuspension(document);
  return applicationGate;
}
