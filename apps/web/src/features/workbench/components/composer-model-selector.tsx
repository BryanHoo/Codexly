import type { AgentModel, AgentTaskSettings } from "@code-agent/protocol";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button, type ButtonProps } from "../../../shared/components/core/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../../shared/components/core/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  effortLabel: string;
  modelLabel: string;
}> &
  Omit<ButtonProps, "aria-label" | "children" | "disabled">;

const workbenchMobileQuery = "(max-width: 760px)";

function useWorkbenchMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(workbenchMobileQuery).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(workbenchMobileQuery);
    const syncViewport = () => {
      setMobile(media.matches);
    };

    // 与工作台 CSS 断点同步，移动端直接切换为不会横向溢出的单层选择界面。
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => {
      media.removeEventListener("change", syncViewport);
    };
  }, []);

  return mobile;
}

function ComposerModelSelectorTrigger({
  accessibleLabel,
  disabled,
  effortLabel,
  modelLabel,
  ...triggerProps
}: ComposerModelSelectorTriggerProps) {
  return (
    <Button
      {...triggerProps}
      aria-label={accessibleLabel}
      className="min-w-0 max-w-44 max-workbench:gap-0.5 max-workbench:px-1"
      data-slot="composer-model-selector"
      disabled={disabled}
      size="sm"
      type="button"
      variant="ghost"
    >
      <span className="min-w-0 truncate">{modelLabel}</span>
      {effortLabel === "" ? null : (
        <span className="shrink-0 text-muted-foreground">{effortLabel}</span>
      )}
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
  const mobile = useWorkbenchMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
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
  const accessibleLabel = t("composer.modelAndReasoningSelect", {
    effort: effortLabel,
    model: modelLabel,
  });

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

  if (mobile) {
    return (
      <Dialog onOpenChange={setMobileOpen} open={mobileOpen}>
        <DialogTrigger asChild>
          <ComposerModelSelectorTrigger
            accessibleLabel={accessibleLabel}
            disabled={selectorDisabled}
            effortLabel={effortLabel}
            modelLabel={modelLabel}
          />
        </DialogTrigger>
        <DialogContent className="w-[calc(100%-1rem)] max-w-xs gap-2 p-3">
          <DialogTitle className="text-body">{t("composer.modelAndReasoningMenu")}</DialogTitle>
          <DialogDescription className="sr-only">{accessibleLabel}</DialogDescription>

          <div aria-label={t("composer.modelSelect")} className="grid gap-0.5" role="radiogroup">
            <div className="px-2 py-1 text-label font-medium text-muted-foreground">
              {t("composer.model")}
            </div>
            {models.map((model) => (
              <Button
                aria-checked={model.id === selectedModel?.id}
                className="w-full"
                contentAlign="start"
                key={model.id}
                onClick={() => {
                  selectModel(model.id);
                  setMobileOpen(false);
                }}
                role="radio"
                size="sm"
                type="button"
                variant="ghost"
              >
                <span className="min-w-0 flex-1 truncate" title={model.displayName}>
                  {model.displayName}
                </span>
                {model.id === selectedModel?.id ? (
                  <Check aria-hidden="true" className="size-3.5" />
                ) : null}
              </Button>
            ))}
          </div>

          <div
            aria-label={t("composer.reasonEffortSelect")}
            className="grid gap-0.5 border-t border-separator pt-1.5"
            role="radiogroup"
          >
            <div className="px-2 py-1 text-label font-medium text-muted-foreground">
              {t("composer.reasoningEffort")}
            </div>
            {selectedModel?.supportedReasoningEfforts.map((option) => {
              const label = t(`settings:effort.${option.id}`, { defaultValue: option.id });
              return (
                <Button
                  aria-checked={option.id === selectedReasoningEffort}
                  className="w-full"
                  contentAlign="start"
                  key={option.id}
                  onClick={() => {
                    selectReasoningEffort(option.id);
                    setMobileOpen(false);
                  }}
                  role="radio"
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {option.id === selectedReasoningEffort ? (
                    <Check aria-hidden="true" className="size-3.5" />
                  ) : null}
                </Button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ComposerModelSelectorTrigger
          accessibleLabel={accessibleLabel}
          disabled={selectorDisabled}
          effortLabel={effortLabel}
          modelLabel={modelLabel}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label={t("composer.modelAndReasoningMenu")}
        className="w-40"
        side="top"
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger aria-label={t("composer.modelSelect")}>
            <span className="font-medium">{t("composer.model")}</span>
            <span className="ml-auto max-w-28 truncate text-muted-foreground">{modelLabel}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            aria-label={t("composer.modelSelect")}
            className="w-40 max-w-[calc(100vw-1rem)]"
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
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger aria-label={t("composer.reasonEffortSelect")}>
            <span className="font-medium">{t("composer.reasoningEffort")}</span>
            <span className="ml-auto truncate text-muted-foreground">{effortLabel}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            aria-label={t("composer.reasonEffortSelect")}
            className="min-w-28 w-28 max-w-[calc(100vw-1rem)]"
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
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
