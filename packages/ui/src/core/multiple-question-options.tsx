import { Input } from "./input.js";
import { Checkbox } from "./checkbox.js";

/** Claude 提问支持多选；复用现有控件和选项样式，不改变 Codex 的单选语义。 */
export function MultipleQuestionOptions({
  options,
  value,
  disabled,
  onChange,
  otherLabel,
}: Readonly<{
  options: readonly Readonly<{ label: string; description: string }>[];
  value: readonly string[];
  disabled: boolean;
  otherLabel?: string;
  onChange: (value: string[]) => void;
}>) {
  return (
    <div className="mt-2 space-y-1.5">
      {options.map((option) => (
        <label
          key={option.label}
          className="flex cursor-pointer items-start gap-2 rounded-control bg-raised px-2.5 py-2 text-label"
        >
          <Checkbox
            disabled={disabled}
            checked={value.includes(option.label)}
            onCheckedChange={(checked) => {
              onChange(
                checked
                  ? [...value, option.label]
                  : value.filter((label) => label !== option.label),
              );
            }}
          />
          <span>
            <span className="block font-medium text-foreground">{option.label}</span>
            <span className="block text-muted-foreground">{option.description}</span>
          </span>
        </label>
      ))}
      {otherLabel ? (
        <Input
          aria-label={otherLabel}
          placeholder={otherLabel}
          disabled={disabled}
          value={value.find((entry) => !options.some((option) => option.label === entry)) ?? ""}
          onChange={(event) => {
            onChange([
              ...value.filter((entry) => options.some((option) => option.label === entry)),
              ...(event.target.value ? [event.target.value] : []),
            ]);
          }}
        />
      ) : null}
    </div>
  );
}
