import type { AgentGlobalSettings, AgentModel } from "@codexly/protocol";
import { useTranslation } from "../../../i18n/i18n.js";
import "../../../i18n/settings-personalization.js";
import { ModelSelect, SettingsField } from "./global-settings-fields.js";

export function CommitSettingsPanel({
  settings,
  models,
  onChange,
  onFlush,
}: Readonly<{
  settings: AgentGlobalSettings;
  models: readonly AgentModel[];
  onChange: (
    update: (current: AgentGlobalSettings) => AgentGlobalSettings,
    debounce?: boolean,
  ) => void;
  onFlush: () => void;
}>) {
  const { t } = useTranslation("settings");
  return (
    <section
      id="personalization-commit-settings"
      aria-labelledby="personalization-commit-title"
      className="space-y-3"
    >
      <div>
        <h2 id="personalization-commit-title" className="text-body font-semibold">
          {t("personalization.commitTitle")}
        </h2>
        <p className="mt-1 text-body-small text-muted-foreground">
          {t("personalization.commitDescription")}
        </p>
      </div>
      <div className="divide-y divide-separator rounded-surface border border-separator bg-panel px-4">
        <SettingsField
          label={t("personalization.commitModel")}
          description={t("personalization.commitModelDescription")}
        >
          <ModelSelect
            ariaLabel={t("fields.commitModel")}
            models={models}
            onChange={(modelId) => {
              onChange((current) => ({ ...current, commitMessageModel: modelId }));
            }}
            value={settings.commitMessageModel}
          />
        </SettingsField>
        <div className="space-y-2 py-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="commit-message-prompt" className="text-body-small font-medium">
              {t("personalization.commitRules")}
            </label>
            <span className="text-label tabular-nums text-subtle-foreground">
              {settings.commitMessagePrompt.length} / 4000
            </span>
          </div>
          <p id="commit-message-prompt-description" className="text-label text-muted-foreground">
            {t("personalization.commitRulesDescription")}
          </p>
          <textarea
            id="commit-message-prompt"
            aria-label={t("fields.commitMessagePrompt")}
            aria-describedby="commit-message-prompt-description"
            className="block min-h-36 w-full resize-y rounded-control border border-separator-strong bg-panel px-3 py-2 text-body-small text-foreground outline-none focus:border-brand focus:shadow-focus disabled:opacity-50"
            placeholder={t("personalization.commitPlaceholder")}
            maxLength={4_000}
            onBlur={onFlush}
            onChange={(event) => {
              const commitMessagePrompt = event.currentTarget.value;
              onChange((current) => ({ ...current, commitMessagePrompt }), true);
            }}
            value={settings.commitMessagePrompt}
          />
        </div>
      </div>
    </section>
  );
}
