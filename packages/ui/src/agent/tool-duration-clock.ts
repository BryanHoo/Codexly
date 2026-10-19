type Subscription = Readonly<{ listener: (nowMs: number) => void }>;

// 每个页面共用一个时钟与观察器；离屏工具只保留观察，不参与 100ms 更新。
class VisibleToolClock {
  readonly #document = document;
  readonly #subscriptions = new Map<Element, Subscription>();
  readonly #visible = new Set<Subscription>();
  readonly #observer: IntersectionObserver | undefined;
  #interval: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.#observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver((entries) => {
            const nowMs = Date.now();
            for (const entry of entries) {
              const subscription = this.#subscriptions.get(entry.target);
              if (subscription === undefined) continue;
              if (entry.isIntersecting) {
                if (this.#visible.has(subscription)) continue;
                this.#visible.add(subscription);
                if (this.#document.visibilityState === "visible") subscription.listener(nowMs);
              } else {
                this.#visible.delete(subscription);
              }
            }
            this.#synchronizeTimer();
          });
    this.#document.addEventListener("visibilitychange", this.#onVisibilityChange);
  }

  subscribe(element: Element, listener: (nowMs: number) => void): () => void {
    const subscription = { listener };
    this.#subscriptions.set(element, subscription);
    if (this.#observer === undefined) {
      // 旧 WebView 无观察器时仍遵循页面可见性，避免计时功能失效。
      this.#visible.add(subscription);
      if (this.#document.visibilityState === "visible") listener(Date.now());
      this.#synchronizeTimer();
    } else {
      this.#observer.observe(element);
    }
    return () => {
      if (!this.#subscriptions.delete(element)) return;
      this.#observer?.unobserve(element);
      this.#visible.delete(subscription);
      this.#synchronizeTimer();
      if (this.#subscriptions.size === 0) {
        this.#observer?.disconnect();
        this.#document.removeEventListener("visibilitychange", this.#onVisibilityChange);
        sharedClock = undefined;
      }
    };
  }

  readonly #tick = (): void => {
    // 使用绝对时间，后台暂停和定时器延迟都不会累计到耗时误差中。
    const nowMs = Date.now();
    for (const subscription of this.#visible) subscription.listener(nowMs);
  };

  readonly #onVisibilityChange = (): void => {
    if (this.#document.visibilityState === "visible") this.#tick();
    this.#synchronizeTimer();
  };

  #synchronizeTimer(): void {
    const shouldRun = this.#document.visibilityState === "visible" && this.#visible.size > 0;
    if (shouldRun && this.#interval === undefined) {
      this.#interval = setInterval(this.#tick, 100);
    } else if (!shouldRun && this.#interval !== undefined) {
      clearInterval(this.#interval);
      this.#interval = undefined;
    }
  }
}

let sharedClock: VisibleToolClock | undefined;

export function subscribeVisibleToolClock(
  element: Element,
  listener: (nowMs: number) => void,
): () => void {
  sharedClock ??= new VisibleToolClock();
  return sharedClock.subscribe(element, listener);
}
