import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../../shared/components/core/button.js";
import { notifyActionSuccess } from "../../notifications/action-notifications.js";
import type { AgentGlobalSettings, AgentModel } from "@/protocol/index.js";
import { useTranslation } from "../../../i18n/i18n.js";
import "../../../i18n/settings-personalization.js";
import { ModelSelect, SettingsField } from "./global-settings-fields.js";

export function CommitSettingsPanel({ settings, models, onChange, onSaveRules }: Readonly<{
  settings: AgentGlobalSettings;
  models: readonly AgentModel[];
  onChange: (update: (current: AgentGlobalSettings) => AgentGlobalSettings, debounce?: boolean) => void;
  onSaveRules: (content: string) => Promise<void>;
}>) {
  const { t } = useTranslation("settings");
  // 规则草稿与全局自动保存队列隔离，仅点击保存时提交，避免失焦或关闭页面误写入。
  const [draft, setDraft] = useState<string | null>(null);
  const content = draft ?? settings.commitMessagePrompt;
  const save = useMutation({
    mutationFn: onSaveRules,
    onSuccess: () => { setDraft(null); notifyActionSuccess(t("personalization.saved")); },
    meta: { actionNotification: false },
  });
  return <section id="personalization-commit-settings" aria-labelledby="personalization-commit-title" className="space-y-3">
    <div>
      <h2 id="personalization-commit-title" className="text-body font-semibold">{t("personalization.commitTitle")}</h2>
      <p className="mt-1 text-body-small text-muted-foreground">{t("personalization.commitDescription")}</p>
    </div>
    <div className="divide-y divide-separator rounded-surface border border-separator bg-panel px-4">
    <SettingsField label={t("personalization.commitModel")} description={t("personalization.commitModelDescription")}>
      <ModelSelect ariaLabel={t("fields.commitModel")} models={models}
        onChange={(modelId) => onChange((current) => ({ ...current, commitMessageModel: modelId }))}
        value={settings.commitMessageModel} />
    </SettingsField>
    <div className="space-y-2 py-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="commit-message-prompt" className="text-body-small font-medium">{t("personalization.commitRules")}</label>
        <Button type="button" variant="secondary" className="shrink-0"
          disabled={save.isPending || content === settings.commitMessagePrompt}
          onClick={() => save.mutate(content)}>
          {t(save.isPending ? "personalization.saving" : "personalization.save")}
        </Button>
      </div>
      <p id="commit-message-prompt-description" className="text-label text-muted-foreground">{t("personalization.commitRulesDescription")}</p>
      <textarea id="commit-message-prompt" aria-label={t("fields.commitMessagePrompt")}
        aria-describedby="commit-message-prompt-description"
        className="block min-h-36 w-full resize-y rounded-control border border-separator-strong bg-panel px-3 py-2 text-body-small text-foreground outline-none focus:border-brand focus:shadow-focus disabled:opacity-50"
        placeholder={t("personalization.commitPlaceholder")}
        maxLength={4_000} disabled={save.isPending} onChange={(event) => {
          setDraft(event.currentTarget.value);
          save.reset();
        }} value={content} />
      <p className="text-right text-label tabular-nums text-subtle-foreground">{content.length} / 4000</p>
      {save.isError ? <p role="alert" className="text-body-small text-danger">{t("personalization.saveError")}</p> : null}
    </div>
    </div>
  </section>;
}
