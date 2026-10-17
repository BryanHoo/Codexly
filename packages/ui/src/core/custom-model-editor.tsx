import { Plus, Trash2 } from "lucide-react";
import { useId } from "react";

import { Button } from "./button.js";
import { Input } from "./input.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

export type CustomModelEditorLabels = Readonly<{
  addModel: string;
  automaticModels: string;
  modelId: string;
  modelName: string;
  models: string;
  removeModel: string;
}>;

export type CustomModelDraft = Readonly<{
  id: string;
  key: string;
  name: string;
}>;

/** 两端共用模型列表；仅在添加模型后展示编辑字段，避免空列表占据额外空间。 */
export function CustomModelEditor({
  labels,
  disabled,
  models,
  onAdd,
  onBlur,
  onChange,
  onRemove,
}: Readonly<{
  labels: CustomModelEditorLabels;
  disabled: boolean;
  models: readonly CustomModelDraft[];
  onAdd: () => void;
  onBlur?: () => void;
  onChange: (key: string, field: "id" | "name", value: string) => void;
  onRemove: (key: string) => void;
}>) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-body font-semibold" id={headingId}>
            {labels.models}
          </h2>
          {models.length === 0 ? (
            <p className="text-body-small text-muted-foreground">{labels.automaticModels}</p>
          ) : null}
        </div>
        <Button
          className="h-8 gap-1.5 text-body-small"
          disabled={disabled || models.length >= 1_000}
          onClick={onAdd}
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {labels.addModel}
        </Button>
      </div>
      {models.length === 0 ? null : (
        <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-3 border-b border-separator pb-2 text-label font-medium text-muted-foreground">
          <span>{labels.modelId}</span>
          <span>{labels.modelName}</span>
          <span />
        </div>
      )}
      {models.map((model) => (
        <div
          className="grid grid-cols-[minmax(0,1fr)_2rem] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-end gap-2 sm:gap-3"
          key={model.key}
        >
          <label className="col-start-1 grid min-w-0 gap-1 sm:col-auto">
            <span className="text-label text-muted-foreground sm:sr-only">{labels.modelId}</span>
            <Input
              onBlur={onBlur}
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
          <label className="col-start-1 grid min-w-0 gap-1 sm:col-auto">
            <span className="text-label text-muted-foreground sm:sr-only">{labels.modelName}</span>
            <Input
              onBlur={onBlur}
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
                aria-label={labels.removeModel}
                className="col-start-2 row-start-1 row-span-2 self-center text-subtle-foreground hover:text-danger sm:col-auto sm:row-auto"
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
            <TooltipContent>{labels.removeModel}</TooltipContent>
          </Tooltip>
        </div>
      ))}
    </section>
  );
}
