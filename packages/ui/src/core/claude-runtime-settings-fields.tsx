import { Input } from "./input.js";
import { ModelContextWindowInput } from "./model-context-window-input.js";
import type { ComponentType, ReactNode, SelectHTMLAttributes } from "react";
import type { AgentModel, ClaudeSettings } from "@codexly/protocol";
import { CLAUDE_MODEL_OPTIONS } from "@codexly/protocol";
import type { claudeSettingsChinese as engineChinese } from "@codexly/frontend-core/claude-settings-labels";

export type ClaudeSettingsControls = Readonly<{
  labels: Readonly<Record<keyof typeof engineChinese, string>>;
  Group: ComponentType<Readonly<{ children: ReactNode; title: string; description?: string }>>;
  Field: ComponentType<
    Readonly<{ children: ReactNode; label: string; description?: string; alignStart?: boolean }>
  >;
  Select: ComponentType<SelectHTMLAttributes<HTMLSelectElement>>;
}>;

/** Claude 运行字段独立展示，复用宿主设置控件，模型切换只校准本组的思考量。 */
export function ClaudeRuntimeSettingsFields({
  settings,
  models,
  disabled,
  labels,
  Group,
  Field,
  Select,
  onChange,
}: ClaudeSettingsControls &
  Readonly<{
    settings: ClaudeSettings;
    models: readonly AgentModel[];
    disabled: boolean;
    onChange: (settings: ClaudeSettings) => void;
  }>) {
  const selectedModel =
    settings.model === "default"
      ? (models.find((model) => model.isDefault) ?? models[0])
      : models.find((model) => model.id === settings.model);
  // 探测不可用时仍能配置三档别名；已有目录只展示其中可用的别名，不补入历史自定义 ID。
  const choices = CLAUDE_MODEL_OPTIONS.filter(
    (option) => models.length === 0 || models.some((model) => model.id === option.id),
  );
  // 只展示引擎报告的思考档位；外部配置的旧值保留显示，切换模型时才校准。
  const efforts =
    selectedModel?.supportedReasoningEfforts.filter((effort) =>
      ["low", "medium", "high", "xhigh", "max"].includes(effort.id),
    ) ?? [];
  return (
    <>
      <Group title={labels.defaults}>
        <Field label={labels.model}>
          <Select
            aria-label={labels.model}
            value={
              choices.some((option) => option.id === settings.model) ? settings.model : "default"
            }
            disabled={disabled}
            onChange={(event) => {
              const model = event.currentTarget.value;
              const target =
                model === "default"
                  ? (models.find((entry) => entry.isDefault) ?? models[0])
                  : models.find((entry) => entry.id === model);
              onChange({
                ...settings,
                model,
                reasoningEffort: target?.supportedReasoningEfforts.some(
                  (entry) => entry.id === settings.reasoningEffort,
                )
                  ? settings.reasoningEffort
                  : "",
              });
            }}
          >
            <option value="default">{labels.automatic}</option>
            {choices.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={labels.effort}
          {...(efforts.length ? {} : { description: labels.effortUnknown })}
        >
          <Select
            aria-label={labels.effort}
            value={settings.reasoningEffort}
            disabled={disabled || (efforts.length === 0 && settings.reasoningEffort === "")}
            onChange={(event) => {
              onChange({
                ...settings,
                reasoningEffort: event.currentTarget.value as ClaudeSettings["reasoningEffort"],
              });
            }}
          >
            <option value="">{labels.effortDefault}</option>
            {settings.reasoningEffort &&
            !efforts.some((effort) => effort.id === settings.reasoningEffort) ? (
              <option value={settings.reasoningEffort}>{labels[settings.reasoningEffort]}</option>
            ) : null}
            {efforts.map((effort) => (
              <option key={effort.id} value={effort.id}>
                {labels[effort.id as "low" | "medium" | "high" | "xhigh" | "max"]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={labels.permissions}
          {...(settings.permissionMode === "auto"
            ? { description: labels.permissionAutoDescription }
            : {})}
        >
          <Select
            aria-label={labels.permissions}
            value={settings.permissionMode}
            disabled={disabled}
            onChange={(event) => {
              onChange({
                ...settings,
                permissionMode: event.currentTarget.value as ClaudeSettings["permissionMode"],
              });
            }}
          >
            <option value="default">{labels.permissionDefault}</option>
            <option value="auto">{labels.permissionAuto}</option>
            <option value="acceptEdits">{labels.permissionEdits}</option>
            <option value="plan">{labels.permissionPlan}</option>
            <option value="dontAsk">{labels.permissionDeny}</option>
            <option value="bypassPermissions">{labels.permissionBypass}</option>
          </Select>
        </Field>
      </Group>
      <Group title={labels.contextSettings} description={labels.contextDescription}>
        <Field label={labels.contextWindow} description={labels.contextWindowDescription}>
          <ModelContextWindowInput
            value={settings.modelContextWindow ?? null}
            minK={1}
            maxK={Math.floor(Number.MAX_SAFE_INTEGER / 1000)}
            disabled={
              disabled ||
              Boolean(settings.environmentOverrides?.includes("CLAUDE_CODE_MAX_CONTEXT_TOKENS"))
            }
            labels={{
              label: labels.contextWindow,
              automatic: labels.automatic,
              invalid: labels.contextWindowInvalid,
            }}
            onChange={(modelContextWindow) => {
              onChange({ ...settings, modelContextWindow });
            }}
          />
        </Field>
        <Field label={labels.autoCompactWindow} description={labels.autoCompactWindowDescription}>
          <ModelContextWindowInput
            value={settings.autoCompactWindow ?? null}
            minK={100}
            maxK={1000}
            disabled={
              disabled ||
              Boolean(settings.environmentOverrides?.includes("CLAUDE_CODE_AUTO_COMPACT_WINDOW"))
            }
            labels={{
              label: labels.autoCompactWindow,
              automatic: labels.automatic,
              invalid: labels.autoCompactWindowInvalid,
            }}
            onChange={(autoCompactWindow) => {
              onChange({ ...settings, autoCompactWindow });
            }}
          />
        </Field>
      </Group>
      <Group title={labels.mappings} description={labels.mappingsDescription}>
        {(["opus", "sonnet", "haiku"] as const).map((alias) => {
          const name = alias.charAt(0).toUpperCase() + alias.slice(1);
          return (
            <Field key={alias} label={name} description={labels[`${alias}Description`]}>
              <Input
                variant="outline"
                aria-label={`${name} ${labels.mappings}`}
                placeholder={labels.mappingDefault}
                value={settings.modelAliases?.[alias] ?? ""}
                disabled={disabled}
                maxLength={256}
                onChange={(event) => {
                  onChange({
                    ...settings,
                    modelAliases: {
                      opus: "",
                      sonnet: "",
                      haiku: "",
                      ...settings.modelAliases,
                      [alias]: event.target.value,
                    },
                  });
                }}
              />
            </Field>
          );
        })}
      </Group>
    </>
  );
}
