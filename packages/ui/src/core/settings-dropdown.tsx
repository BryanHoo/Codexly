import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
export interface SettingsDropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}
/** 与设置弹窗共用 Base UI 浮层：外部点击先收起下拉，不透传到设置遮罩。 */
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
    <Select.Root<string>
      value={`value:${value}`}
      onValueChange={(encoded) => {
        if (encoded !== null) onValueChange(encoded.slice(6));
      }}
      disabled={disabled}
    >
      <Select.Trigger
        aria-label={label}
        className="flex h-8 w-full min-w-0 max-w-[22rem] items-center justify-between gap-2 rounded-control border border-separator-strong bg-control px-3 text-body-small outline-none hover:bg-control-hover focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Select.Value className="min-w-0 truncate">
          {options.find((option) => option.value === value)?.label ?? (value || label)}
        </Select.Value>
        <Select.Icon className="shrink-0 text-muted-foreground" aria-hidden="true">
          <ChevronDown className="size-4 opacity-50" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        {/* 与设置遮罩同层但后挂载，首次外点只能命中下拉自己的透明遮罩。 */}
        <Select.Backdrop className="fixed inset-0 z-50" />
        <Select.Positioner
          align="start"
          sideOffset={4}
          alignItemWithTrigger={false}
          className="z-50 w-(--anchor-width) max-w-(--available-width)"
        >
          <Select.Popup className="max-h-(--available-height) overflow-y-auto overscroll-contain rounded-control border border-separator bg-raised p-1 text-foreground shadow-panel outline-none">
            <Select.List>
              {groups.map((group) => (
                <Select.Group key={group ?? "default"}>
                  {group ? (
                    <Select.GroupLabel className="px-2 py-1.5 text-label text-muted-foreground">
                      {group}
                    </Select.GroupLabel>
                  ) : null}
                  {options
                    .filter((option) => option.group === group)
                    .map((option) => (
                      <Select.Item
                        key={option.value}
                        label={option.label}
                        value={`value:${option.value}`}
                        disabled={option.disabled ?? false}
                        className="relative cursor-default rounded-control py-1.5 pl-2 pr-8 text-label outline-none select-none data-highlighted:bg-control-hover data-disabled:opacity-50"
                      >
                        <Select.ItemText className="wrap-anywhere">{option.label}</Select.ItemText>
                        <Select.ItemIndicator className="absolute inset-e-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                          <Check className="size-3.5" aria-hidden="true" />
                        </Select.ItemIndicator>
                      </Select.Item>
                    ))}
                </Select.Group>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
