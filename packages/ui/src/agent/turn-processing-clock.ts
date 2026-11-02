type Listener = (nowMs: number) => void;

// 同一页面的运行回合共用秒级时钟，分屏不会重复创建定时器和可见性监听。
const listeners = new Set<Listener>();
let intervalId: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  const nowMs = Date.now();
  for (const listener of listeners) listener(nowMs);
}

function stop(): void {
  if (intervalId !== undefined) clearInterval(intervalId);
  intervalId = undefined;
}

function synchronize(): void {
  stop();
  if (document.visibilityState !== "visible" || listeners.size === 0) return;
  // 恢复时直接读取时间戳，不补跑后台 tick，避免累计误差和集中提交状态。
  tick();
  intervalId = setInterval(tick, 1_000);
}

export function subscribeTurnProcessingClock(listener: Listener): () => void {
  // 每次订阅使用独立身份，避免同一回调的两个消费者互相取消订阅。
  const subscription: Listener = (nowMs) => {
    listener(nowMs);
  };
  listeners.add(subscription);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", synchronize);
    synchronize();
  } else if (document.visibilityState === "visible") {
    subscription(Date.now());
  }
  return () => {
    listeners.delete(subscription);
    if (listeners.size !== 0) return;
    stop();
    document.removeEventListener("visibilitychange", synchronize);
  };
}
