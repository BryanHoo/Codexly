import type { AgentModel, AgentTaskSettings } from "@codexly/protocol";
import { ChevronDown } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button, type ButtonProps } from "../../../shared/components/core/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import { resolveReasoningEffort } from "../composer-state.js";

type ComposerModelSelectorProps = Readonly<{
  activeSettings: AgentTaskSettings;
  disabled: boolean;
  models: readonly AgentModel[];
  modelsPending: boolean;
  onSettingsChange: (settings: AgentTaskSettings, field: keyof AgentTaskSettings) => void;
  selectedModel: AgentModel | undefined;
  selectedReasoningEffort: string | undefined;
}>;

type ComposerModelSelectorTriggerProps = Readonly<{
  accessibleLabel: string;
  disabled: boolean;
  label: string;
  slot: string;
}> &
  Omit<ButtonProps, "aria-label" | "children" | "disabled">;

function ComposerModelSelectorTrigger({
  accessibleLabel,
  disabled,
  label,
  slot,
  ...triggerProps
}: ComposerModelSelectorTriggerProps) {
  return (
    <Button
      {...triggerProps}
      aria-label={accessibleLabel}
      className="min-w-0 max-w-36 max-workbench:shrink max-workbench:gap-0.5 max-workbench:px-1"
      data-slot={slot}
      disabled={disabled}
      size="sm"
      type="button"
      variant="ghost"
    >
      <span className="min-w-0 truncate">{label}</span>
      <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
    </Button>
  );
}

export function resolveComposerModelSelection(
  models: readonly AgentModel[],
  settings: AgentTaskSettings,
  modelId: string,
): AgentTaskSettings | undefined {
  const model = models.find((candidate) => candidate.id === modelId);
  const reasoningEffort = resolveReasoningEffort(model, settings.reasoningEffort);
  if (model === undefined || reasoningEffort === undefined) {
    return undefined;
  }
  return { ...settings, model: model.id, reasoningEffort };
}

export function resolveComposerReasoningSelection(
  model: AgentModel | undefined,
  settings: AgentTaskSettings,
  reasoningEffort: string,
): AgentTaskSettings | undefined {
  if (!model?.supportedReasoningEfforts.some((option) => option.id === reasoningEffort)) {
    return undefined;
  }
  return { ...settings, reasoningEffort };
}

export function ComposerModelSelector({
  activeSettings,
  disabled,
  models,
  modelsPending,
  onSettingsChange,
  selectedModel,
  selectedReasoningEffort,
}: ComposerModelSelectorProps) {
  const { t } = useTranslation(["workbench", "settings"]);
  const modelLabel =
    selectedModel?.displayName ??
    (modelsPending ? t("composer.modelLoading") : t("composer.noModels"));
  const effortLabel =
    selectedReasoningEffort === undefined
      ? ""
      : t(`settings:effort.${selectedReasoningEffort}`, {
          defaultValue: selectedReasoningEffort,
        });
  const selectorDisabled = disabled || modelsPending || selectedModel === undefined;

  const selectModel = (modelId: string) => {
    const settings = resolveComposerModelSelection(models, activeSettings, modelId);
    if (settings !== undefined) {
      onSettingsChange(settings, "model");
    }
  };

  const selectReasoningEffort = (reasoningEffort: string) => {
    const settings = resolveComposerReasoningSelection(
      selectedModel,
      activeSettings,
      reasoningEffort,
    );
    if (settings !== undefined) {
      onSettingsChange(settings, "reasoningEffort");
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ComposerModelSelectorTrigger
            accessibleLabel={t("composer.modelSelectCurrent", { model: modelLabel })}
            disabled={selectorDisabled}
            label={modelLabel}
            slot="composer-model-selector"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          aria-label={t("composer.modelSelect")}
          className="w-40 max-w-[calc(100vw-1rem)]"
          side="top"
        >
          <DropdownMenuRadioGroup
            onValueChange={selectModel}
            {...(selectedModel === undefined ? {} : { value: selectedModel.id })}
          >
            {models.map((model) => (
              <DropdownMenuRadioItem indicator="check" key={model.id} value={model.id}>
                <span className="min-w-0 truncate" title={model.displayName}>
                  {model.displayName}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ComposerModelSelectorTrigger
            accessibleLabel={t("composer.reasonEffortSelectCurrent", { effort: effortLabel })}
            disabled={selectorDisabled || selectedReasoningEffort === undefined}
            label={effortLabel}
            slot="composer-reasoning-selector"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          aria-label={t("composer.reasonEffortSelect")}
          className="w-28 min-w-0 max-w-[calc(100vw-1rem)]"
          side="top"
        >
          <DropdownMenuRadioGroup
            onValueChange={selectReasoningEffort}
            {...(selectedReasoningEffort === undefined ? {} : { value: selectedReasoningEffort })}
          >
            {selectedModel?.supportedReasoningEfforts.map((option) => (
              <DropdownMenuRadioItem indicator="check" key={option.id} value={option.id}>
                <span className="min-w-0 truncate">
                  {t(`settings:effort.${option.id}`, { defaultValue: option.id })}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
