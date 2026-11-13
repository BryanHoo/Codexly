import { SettingsDropdown } from "./settings-dropdown.js";
import { Switch } from "./switch.js";
import { memo, type ComponentType, type ReactNode, type SelectHTMLAttributes } from "react";
import { isAcpConfigOption } from "@codexly/protocol/acp-config-validation";
import { acpConfigLabel, acpConfigDescription } from "@codexly/frontend-core/acp-config-labels";
import { Checkbox } from "./checkbox.js";
interface FieldProps {
  label: string;
  description?: string;
  children: ReactNode;
}
export interface AcpConfigOptionsProps {
  options: readonly unknown[];
  disabled?: boolean;
  language?: string;
  settingsControls?: boolean;
  Field: ComponentType<FieldProps>;
  Select: ComponentType<SelectHTMLAttributes<HTMLSelectElement>>;
  onChange: (id: string, value: string | boolean) => void;
  onCommit?: (id: string) => void;
}
/** 只翻译展示文案；原始标识、分组和值原样交回 ACP，不能用翻译字符串写入配置。 */
export const AcpConfigOptions = memo(function AcpConfigOptions({
  options,
  language,
  settingsControls = false,
  disabled,
  Field,
  Select,
  onChange,
  onCommit,
}: AcpConfigOptionsProps) {
  return (
    <>
      {options.filter(isAcpConfigOption).map((option) => {
        const description = acpConfigDescription(option.description, language);
        const label = acpConfigLabel(option.name, language);
        const choiceLabel = (name: string) =>
          !name.trim()
            ? language === "zh-CN"
              ? "默认"
              : "Default"
            : option.category === "model" || option.id === "model"
              ? name
              : acpConfigLabel(name, language);
        return (
          <Field key={option.id} label={label} {...(description ? { description } : {})}>
            <div
              className={option.type === "boolean" ? "flex justify-end" : "w-full max-w-[22rem]"}
              onBlur={(event) => {
                const next = event.relatedTarget;
                // Select 的选项在 Portal 内；进入选项不是结束编辑，返回触发器后真正失焦才提交。
                if (
                  next instanceof Element &&
                  (event.currentTarget.contains(next) ||
                    next.closest('[data-slot="select-content"]'))
                )
                  return;
                onCommit?.(option.id);
              }}
            >
              {option.type === "boolean" && settingsControls ? (
                <Switch
                  aria-label={label}
                  checked={option.currentValue}
                  onClick={(event) => {
                    event.currentTarget.focus();
                  }}
                  disabled={disabled ?? false}
                  onCheckedChange={(value) => {
                    onChange(option.id, value);
                  }}
                />
              ) : option.type === "boolean" ? (
                <Checkbox
                  aria-label={label}
                  disabled={disabled}
                  checked={option.currentValue}
                  onCheckedChange={(value) => {
                    if (typeof value === "boolean") onChange(option.id, value);
                  }}
                />
              ) : settingsControls ? (
                <SettingsDropdown
                  label={label}
                  value={option.currentValue}
                  disabled={disabled ?? false}
                  onValueChange={(value) => {
                    onChange(option.id, value);
                  }}
                  options={option.options.flatMap((choice) =>
                    "group" in choice
                      ? choice.options.map((item) => ({
                          value: item.value,
                          label: choiceLabel(item.name),
                          group: acpConfigLabel(choice.name, language),
                        }))
                      : [{ value: choice.value, label: choiceLabel(choice.name) }],
                  )}
                />
              ) : (
                <Select
                  aria-label={label}
                  disabled={disabled}
                  value={option.currentValue}
                  onChange={(event) => {
                    onChange(option.id, event.currentTarget.value);
                  }}
                >
                  {!option.options.some((choice) =>
                    "group" in choice
                      ? choice.options.some((item) => item.value === option.currentValue)
                      : choice.value === option.currentValue,
                  ) ? (
                    <option disabled value={option.currentValue}>
                      {option.currentValue}
                    </option>
                  ) : null}
                  {option.options.map((choice) =>
                    "group" in choice ? (
                      <optgroup key={choice.group} label={acpConfigLabel(choice.name, language)}>
                        {choice.options.map((item) => (
                          <option key={item.value} value={item.value}>
                            {choiceLabel(item.name)}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      <option key={choice.value} value={choice.value}>
                        {choiceLabel(choice.name)}
                      </option>
                    ),
                  )}
                </Select>
              )}
            </div>
          </Field>
        );
      })}
    </>
  );
});
