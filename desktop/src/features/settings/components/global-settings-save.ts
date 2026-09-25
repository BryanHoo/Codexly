import type { AgentGlobalSettings } from "@/protocol/index.js";

export const SETTINGS_INPUT_DEBOUNCE_MS = 400;

export type GlobalSettingsSaveQueue = Readonly<{
  flush: (settings?: AgentGlobalSettings) => Promise<void>;
  reset: (settings: AgentGlobalSettings) => void;
  save: (settings: AgentGlobalSettings) => void;
  schedule: (settings: AgentGlobalSettings, delayMs: number) => void;
}>;

export function createGlobalSettingsSaveQueue(
  saveSettings: (settings: AgentGlobalSettings) => Promise<void>,
): GlobalSettingsSaveQueue {
  let savedHash = "";
  let pending: AgentGlobalSettings | undefined;
  let scheduled: AgentGlobalSettings | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;

  const clearScheduledTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const drain = (): Promise<void> => {
    if (active !== undefined) return active;
    active = (async () => {
      while (pending !== undefined) {
        const next = pending;
        pending = undefined;
        const nextHash = JSON.stringify(next);
        if (nextHash === savedHash) continue;
        try {
          await saveSettings(next);
          savedHash = nextHash;
        } catch {
          // MutationCache 已展示失败；后续更改或关闭设置时会用最新快照重试。
        }
      }
    })().finally(() => {
      active = undefined;
      if (pending !== undefined) void drain();
    });
    return active;
  };

  const save = (settings: AgentGlobalSettings) => {
    clearScheduledTimer();
    scheduled = undefined;
    pending = settings;
    void drain();
  };

  return {
    async flush(settings) {
      clearScheduledTimer();
      pending = settings ?? scheduled ?? pending;
      scheduled = undefined;
      while (pending !== undefined || active !== undefined) {
        await drain();
      }
    },
    reset(settings) {
      savedHash = JSON.stringify(settings);
    },
    save,
    schedule(settings, delayMs) {
      clearScheduledTimer();
      scheduled = settings;
      timer = setTimeout(() => {
        timer = undefined;
        pending = scheduled;
        scheduled = undefined;
        void drain();
      }, delayMs);
    },
  };
}
