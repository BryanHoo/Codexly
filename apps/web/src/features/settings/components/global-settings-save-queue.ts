import type { AgentGlobalSettings } from "@codexly/protocol";
import {
  createSettingsAutosave,
  type SettingsSaveStatus,
} from "@codexly/frontend-core/settings-autosave";
export { SETTINGS_INPUT_DEBOUNCE_MS } from "@codexly/frontend-core/settings-autosave";

/** 保留页面调用契约，队列实现由双端共享，防止自动保存行为再次分叉。 */
export function createGlobalSettingsSaveQueue(
  saveSettings: (settings: AgentGlobalSettings) => Promise<void>,
  onStatus?: (status: SettingsSaveStatus) => void,
) {
  const queue = createSettingsAutosave(saveSettings, onStatus);
  return {
    reset: (settings: AgentGlobalSettings) => {
      queue.reset(settings);
    },
    save: (settings: AgentGlobalSettings) => {
      queue.save(settings);
    },
    schedule: (settings: AgentGlobalSettings, delayMs: number) => {
      queue.schedule(settings, delayMs);
    },
    async flush(settings?: AgentGlobalSettings) {
      if (settings !== undefined) queue.save(settings);
      return queue.flush();
    },
  };
}
export type GlobalSettingsSaveQueue = ReturnType<typeof createGlobalSettingsSaveQueue>;
