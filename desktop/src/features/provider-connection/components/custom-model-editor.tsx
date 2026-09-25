import { Server, Plus, Trash2 } from "lucide-react";
import { useId } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Input } from "../../../shared/components/core/input.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";

export type CustomModelDraft = Readonly<{
  id: string;
  key: string;
  name: string;
}>;

export function CustomModelEditor({
  disabled,
  models,
  onAdd,
  onChange,
  onRemove,
}: Readonly<{
  disabled: boolean;
  models: readonly CustomModelDraft[];
  onAdd: () => void;
  onChange: (key: string, field: "id" | "name", value: string) => void;
  onRemove: (key: string) => void;
}>) {
  const { t } = useTranslation("settings");
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-body font-semibold" id={headingId}>{t("provider.models")}</h2>
          {models.length === 0 ? null : <span className="text-label tabular-nums text-subtle-foreground">{t("provider.modelCount", { count: models.length })}</span>}
        </div>
        <Button className="h-8 gap-1.5 text-body-small" disabled={disabled || models.length >= 1_000} onClick={onAdd} type="button" variant="outline">
          <Plus aria-hidden="true" className="size-3.5" />
          {t("provider.addModel")}
        </Button>
      </div>
      {models.length === 0 ? (
        <div className="flex min-h-20 items-center gap-3 border-y border-separator text-muted-foreground">
          <Server aria-hidden="true" className="size-5 shrink-0 text-subtle-foreground" />
          <span className="text-body-small">{t("provider.automaticModels")}</span>
        </div>
      ) : null}
      {models.length === 0 ? null : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-3 border-b border-separator pb-2 text-label font-medium text-muted-foreground">
          <span>{t("provider.modelId")}</span>
          <span>{t("provider.modelName")}</span>
          <span />
        </div>
      )}
      {models.map((model) => (
        <div
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-3"
          key={model.key}
        >
          <label className="grid min-w-0 gap-1">
            <span className="sr-only">
              {t("provider.modelId")}
            </span>
            <Input
              autoCapitalize="none"
              autoComplete="off"
              className="font-mono"
              disabled={disabled}
              maxLength={256}
              onChange={(event) => {
                onChange(model.key, "id", event.currentTarget.value);
              }}
              spellCheck={false}
              placeholder="gpt-5.4"
              value={model.id}
              variant="outline"
            />
          </label>
          <label className="grid min-w-0 gap-1">
            <span className="sr-only">
              {t("provider.modelName")}
            </span>
            <Input
              autoComplete="off"
              disabled={disabled}
              maxLength={256}
              placeholder="GPT-5.4"
              onChange={(event) => {
                onChange(model.key, "name", event.currentTarget.value);
              }}
              value={model.name}
              variant="outline"
            />
          </label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("provider.removeModel")}
                className="text-subtle-foreground hover:text-danger"
                disabled={disabled}
                onClick={() => {
                  onRemove(model.key);
                }}
                size="icon-compact"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("provider.removeModel")}</TooltipContent>
          </Tooltip>
        </div>
      ))}
    </section>
  );
}
