import { memo, type ComponentType, type ReactNode, type SelectHTMLAttributes } from "react";
import { isAcpConfigOption } from "@codexly/protocol/acp-config-validation";
import { Checkbox } from "./checkbox.js";

interface FieldProps {
  label: string;
  description?: string;
  children: ReactNode;
}
export interface AcpConfigOptionsProps {
  options: readonly unknown[];
  disabled?: boolean;
  Field: ComponentType<FieldProps>;
  Select: ComponentType<SelectHTMLAttributes<HTMLSelectElement>>;
  onChange: (id: string, value: string | boolean) => void;
}

/** 双端注入既有设置布局；名称、分组和值全部使用 ACP 公布内容。 */
export const AcpConfigOptions = memo(function AcpConfigOptions({
  options,
  disabled,
  Field,
  Select,
  onChange,
}: AcpConfigOptionsProps) {
  return (
    <>
      {options.filter(isAcpConfigOption).map((option) => (
        <Field
          key={option.id}
          label={option.name}
          {...(option.description ? { description: option.description } : {})}
        >
          {option.type === "boolean" ? (
            <Checkbox
              aria-label={option.name}
              disabled={disabled}
              checked={option.currentValue}
              onCheckedChange={(value) => {
                if (typeof value === "boolean") onChange(option.id, value);
              }}
            />
          ) : (
            <Select
              aria-label={option.name}
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
                  <optgroup key={choice.group} label={choice.name}>
                    {choice.options.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  <option key={choice.value} value={choice.value}>
                    {choice.name}
                  </option>
                ),
              )}
            </Select>
          )}
        </Field>
      ))}
    </>
  );
});
