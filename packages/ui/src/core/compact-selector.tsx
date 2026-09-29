import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "./button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";

export function CompactSelectorTrigger({ children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      className="min-w-0 max-w-36 max-workbench:shrink max-workbench:gap-0.5 max-workbench:px-1"
      size="sm"
      type="button"
      variant="ghost"
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
    </Button>
  );
}

export function CompactSelector<T extends string>({
  disabled,
  label,
  onValueChange,
  options,
  value,
}: Readonly<{
  disabled: boolean;
  label: string;
  onValueChange: (value: T) => void;
  options: readonly Readonly<{ value: T; label: string }>[];
  value: T;
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <CompactSelectorTrigger aria-label={label} disabled={disabled} value={value}>
          {options.find((option) => option.value === value)?.label}
        </CompactSelectorTrigger>
      </DropdownMenuTrigger>
      {/* 使用锚点与碰撞边界定位，避免移动浏览器原生选择器偏离触发按钮。 */}
      <DropdownMenuContent
        align="start"
        aria-label={label}
        className="max-w-[calc(100vw-1rem)]"
        side="top"
      >
        <DropdownMenuRadioGroup
          onValueChange={(nextValue) => {
            const option = options.find((candidate) => candidate.value === nextValue);
            if (option) onValueChange(option.value);
          }}
          value={value}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem indicator="check" key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
