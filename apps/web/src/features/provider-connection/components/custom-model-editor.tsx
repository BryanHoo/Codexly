import { Plus, Trash2 } from "lucide-react";

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

  return (
    <div className="grid gap-2">
      {models.length === 0 ? null : (
        <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2 px-1 text-meta font-medium text-muted-foreground sm:grid">
          <span>{t("provider.modelId")}</span>
          <span>{t("provider.modelName")}</span>
          <span />
        </div>
      )}
      {models.map((model) => (
        <div
          className="grid gap-2 border-b border-separator pb-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] sm:items-end"
          key={model.key}
        >
          <label className="grid min-w-0 gap-1">
            <span className="text-meta font-medium text-muted-foreground sm:sr-only">
              {t("provider.modelId")}
            </span>
            <Input
              autoCapitalize="none"
              autoComplete="off"
              disabled={disabled}
              maxLength={256}
              onChange={(event) => {
                onChange(model.key, "id", event.currentTarget.value);
              }}
              spellCheck={false}
              value={model.id}
              variant="outline"
            />
          </label>
          <label className="grid min-w-0 gap-1">
            <span className="text-meta font-medium text-muted-foreground sm:sr-only">
              {t("provider.modelName")}
            </span>
            <Input
              autoComplete="off"
              disabled={disabled}
              maxLength={256}
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
                className="justify-self-end sm:justify-self-auto"
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
      <Button
        className="justify-self-start"
        disabled={disabled || models.length >= 1_000}
        onClick={onAdd}
        type="button"
        variant="outline"
      >
        <Plus aria-hidden="true" className="size-4" />
        {t("provider.addModel")}
      </Button>
    </div>
  );
}
