export type SettingsSaveStatus = "idle" | "saving" | "saved" | "error";
export const SETTINGS_INPUT_DEBOUNCE_MS = 400;

/** 两端共用的设置保存队列：合并文本输入，串行写入，失败快照只在用户重试或继续编辑时提交。 */
export function createSettingsAutosave<T>(
  persist: (value: T) => Promise<void>,
  onStatus: (status: SettingsSaveStatus) => void = () => undefined,
) {
  let status: SettingsSaveStatus = "idle";
  let savedHash: string | undefined;
  let pending: { value: T } | undefined;
  let scheduled: { value: T } | undefined;
  let failed: { value: T } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  const report = (next: SettingsSaveStatus) => {
    status = next;
    onStatus(next);
  };
  const cancelTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const drain = (): Promise<void> => {
    if (active) return active;
    active = (async () => {
      while (pending) {
        const next = pending;
        pending = undefined;
        const hash = JSON.stringify(next.value);
        if (hash === savedHash) {
          if (failed) {
            failed = undefined;
            report("saved");
          }
          continue;
        }
        report("saving");
        try {
          await persist(next.value);
          savedHash = hash;
          failed = undefined;
          report("saved");
        } catch {
          failed = next;
          report("error");
        }
      }
    })().finally(() => {
      active = undefined;
      if (pending) void drain();
    });
    return active;
  };
  const flush = async (): Promise<boolean> => {
    cancelTimer();
    pending = scheduled ?? pending;
    scheduled = undefined;
    while (pending || active) await drain();
    return status !== "error";
  };
  return {
    get status() {
      return status;
    },
    reset(value: T) {
      savedHash = JSON.stringify(value);
    },
    save(value: T) {
      cancelTimer();
      scheduled = undefined;
      pending = { value };
      void drain();
    },
    schedule(value: T, delay = SETTINGS_INPUT_DEBOUNCE_MS) {
      cancelTimer();
      if (status === "saved" && !active) report("idle");
      scheduled = { value };
      timer = setTimeout(() => {
        void flush();
      }, delay);
    },
    discard() {
      cancelTimer();
      scheduled = undefined;
      pending = undefined;
      failed = undefined;
      report("idle");
    },
    cancelScheduled() {
      cancelTimer();
      scheduled = undefined;
      if (status === "saved" && !active) report("idle");
    },
    flush,
    async retry() {
      pending = scheduled ?? pending ?? failed;
      return flush();
    },
  };
}
