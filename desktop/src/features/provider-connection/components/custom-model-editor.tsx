import type { ComponentProps } from "react";
import { CustomModelEditor as SharedCustomModelEditor } from "@codexly/ui/core/custom-model-editor";
import "../../../i18n/settings-provider.js";
import { useTranslation } from "../../../i18n/i18n.js";
export type { CustomModelDraft } from "@codexly/ui/core/custom-model-editor";

export function CustomModelEditor(props: Omit<ComponentProps<typeof SharedCustomModelEditor>, "labels">) {
  const { t } = useTranslation("settings");
  return <SharedCustomModelEditor {...props} labels={{
    addModel: t("provider.addModel"),
    automaticModels: t("provider.automaticModels"),
    modelId: t("provider.modelId"),
    modelName: t("provider.modelName"),
    models: t("provider.models"),
    removeModel: t("provider.removeModel"),
  }} />;
}
