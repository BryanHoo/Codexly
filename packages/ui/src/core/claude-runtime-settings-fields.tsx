import { Input } from "./input.js";
import type { ComponentType, ReactNode, SelectHTMLAttributes } from "react";
import type { AgentModel, ClaudeSettings } from "@codexly/protocol";
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
            value={settings.model}
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
            {(models.length === 0 ? (["opus", "sonnet", "haiku"] as const) : [])
              .filter((alias) => !models.some((entry) => entry.id === alias))
              .map((alias) => (
                <option key={alias} value={alias}>
                  {alias.charAt(0).toUpperCase() + alias.slice(1)}
                  {settings.modelAliases?.[alias] ? ` → ${settings.modelAliases[alias]}` : ""}
                </option>
              ))}
            {settings.model !== "default" &&
            (models.length > 0 || !["opus", "sonnet", "haiku"].includes(settings.model)) &&
            !models.some((model) => model.id === settings.model) ? (
              <option value={settings.model}>{settings.model}</option>
            ) : null}
            {models
              .filter((model) => model.id !== "default")
              .map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                  {!model.displayName.includes(" → ") &&
                  settings.modelAliases?.[model.id as "opus" | "sonnet" | "haiku"]
                    ? ` → ${settings.modelAliases[model.id as "opus" | "sonnet" | "haiku"]}`
                    : ""}
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
