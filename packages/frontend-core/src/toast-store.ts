export type ToastType = "success" | "error" | "warning" | "info";
export type ToastId = string | number;
export type ToastOptions = Readonly<{
  id?: ToastId;
  description?: string;
  duration?: number;
  action?: Readonly<{ label: string; onClick: () => void }>;
}>;
export type ToastEntry = Readonly<ToastOptions & { id: ToastId; type: ToastType; message: string }>;

export const MAX_VISIBLE_TOASTS = 3;
export const TOAST_DURATION_MS: Readonly<Record<ToastType, number>> = {
  success: 2000,
  info: 3000,
  warning: 4000,
  error: 4000,
};

interface Lifetime {
  deadline: number;
  remaining: number;
  pauses: Set<string>;
}

/** 双端共用的有界通知容器：没有待播队列，所有到期时间由同一个一次性定时器管理。 */
export function createToastStore() {
  let entries: readonly ToastEntry[] = [];
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const lifetimes = new Map<ToastId, Lifetime>();
  const emit = () => {
    listeners.forEach((listener) => {
      listener();
    });
  };
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    let deadline = Infinity;
    for (const lifetime of lifetimes.values()) {
      if (!lifetime.pauses.size) deadline = Math.min(deadline, lifetime.deadline);
    }
    if (Number.isFinite(deadline)) timer = setTimeout(sweep, Math.max(0, deadline - Date.now()));
  };
  // 用绝对截止时间校准后台被节流的计时器，恢复窗口时不会重新播放已经过期的通知。
  const sweep = () => {
    const now = Date.now();
    const next = entries.filter((entry) => {
      const lifetime = lifetimes.get(entry.id);
      if (lifetime && (lifetime.pauses.size || lifetime.deadline > now)) return true;
      lifetimes.delete(entry.id);
      return false;
    });
    if (next.length !== entries.length) {
      entries = next;
      emit();
    }
    schedule();
  };
  const dismiss = (id?: ToastId) => {
    const next = id === undefined ? [] : entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) return;
    entries = next;
    if (id === undefined) lifetimes.clear();
    else lifetimes.delete(id);
    schedule();
    emit();
  };
  const resume = (id: ToastId, reason: string) => {
    const lifetime = lifetimes.get(id);
    if (!lifetime?.pauses.delete(reason) || lifetime.pauses.size) return;
    lifetime.deadline = Date.now() + lifetime.remaining;
    schedule();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    getSnapshot: () => entries,
    subscribe,
    show(type: ToastType, message: string, options: ToastOptions = {}): ToastId {
      sweep();
      const existing =
        options.id === undefined
          ? entries.find(
              (entry) =>
                entry.type === type &&
                entry.message === message &&
                entry.description === options.description &&
                entry.action?.label === options.action?.label,
            )
          : entries.find((entry) => entry.id === options.id);
      const id = options.id ?? existing?.id ?? ++sequence;
      // 同一结果不续命；同一业务 ID 的错误变成功则更新内容，并从新状态开始计时。
      if (
        existing?.type === type &&
        existing.message === message &&
        existing.description === options.description &&
        existing.action?.label === options.action?.label
      )
        return id;
      const requestedDuration = options.duration ?? TOAST_DURATION_MS[type];
      const duration =
        Number.isFinite(requestedDuration) && requestedDuration > 0
          ? requestedDuration
          : TOAST_DURATION_MS[type];
      lifetimes.set(id, {
        deadline: Date.now() + duration,
        remaining: duration,
        pauses: new Set(lifetimes.get(id)?.pauses),
      });
      entries = [{ ...options, id, type, message }, ...entries.filter((entry) => entry.id !== id)];
      for (const entry of entries.slice(MAX_VISIBLE_TOASTS)) lifetimes.delete(entry.id);
      entries = entries.slice(0, MAX_VISIBLE_TOASTS);
      schedule();
      emit();
      return id;
    },
    dismiss,
    pause(id: ToastId, reason: string) {
      const lifetime = lifetimes.get(id);
      if (!lifetime) return;
      if (!lifetime.pauses.size) lifetime.remaining = Math.max(0, lifetime.deadline - Date.now());
      lifetime.pauses.add(reason);
      schedule();
    },
    resume,
    releaseInteractions() {
      for (const [id, lifetime] of lifetimes) {
        for (const reason of lifetime.pauses) resume(id, reason);
      }
    },
    sweep,
  };
}
