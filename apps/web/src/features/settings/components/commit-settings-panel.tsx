import type { AgentGlobalSettings } from "@codexly/protocol";
import { GenerationPromptsSettings } from "@codexly/ui/core/generation-prompts-settings";
import { getCurrentLanguage } from "../../../i18n/i18n.js";

export function CommitSettingsPanel({
  settings,
  onChange,
  onFlush,
}: Readonly<{
  settings: AgentGlobalSettings;
  onChange: (
    update: (current: AgentGlobalSettings) => AgentGlobalSettings,
    debounce?: boolean,
  ) => void;
  onFlush: () => void;
}>) {
  return (
    <GenerationPromptsSettings
      settings={settings}
      language={getCurrentLanguage()}
      onChange={(field, value) => {
        onChange((current) => ({ ...current, [field]: value }), true);
      }}
      onFlush={onFlush}
    />
  );
}
