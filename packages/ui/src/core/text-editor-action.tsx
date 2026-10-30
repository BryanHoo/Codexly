import { Button, type ButtonProps } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

/** 统一编辑器命令的提示与可访问名称；禁用按钮仍可通过外层触发器查看说明。 */
export function TextEditorAction({
  label,
  shortcut,
  children,
  ...props
}: ButtonProps & Readonly<{ label: string; shortcut?: string }>) {
  const button = (
    <Button type="button" aria-label={label} {...props}>
      {children}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {props.disabled ? <span className="inline-flex">{button}</span> : button}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-3">
        <span>{label}</span>
        {shortcut ? <kbd className="font-mono text-[10px] opacity-60">{shortcut}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}
