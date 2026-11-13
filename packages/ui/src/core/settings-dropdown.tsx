import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./select.js";
export interface SettingsDropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}
/** 统一复用项目 Select，支持键盘、Portal、分组与移动端碰撞定位。 */
export function SettingsDropdown({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
}: Readonly<{
  label: string;
  value: string;
  options: readonly SettingsDropdownOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
}>) {
  // ACP 允许空字符串代表默认值；Select 内部使用非空编码，写回仍保留原值。
  const groups = [...new Set(options.map((option) => option.group))];
  return (
    <Select
      value={`value:${value}`}
      onValueChange={(encoded) => {
        onValueChange(encoded.slice(6));
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        aria-label={label}
        className="h-8 w-full max-w-[22rem] bg-control text-body-small"
      >
        <SelectValue placeholder={label}>
          {options.find((option) => option.value === value)?.label ?? (value || label)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper">
        {groups.map((group) => (
          <SelectGroup key={group ?? "default"}>
            {group ? <SelectLabel>{group}</SelectLabel> : null}
            {options
              .filter((option) => option.group === group)
              .map((option) => (
                <SelectItem
                  key={option.value}
                  value={`value:${option.value}`}
                  disabled={option.disabled ?? false}
                >
                  {option.label}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
