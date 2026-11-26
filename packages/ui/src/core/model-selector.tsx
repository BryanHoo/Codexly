/**
 * 基于 AI Elements Model Selector 的 Command 组合模式适配项目样式。
 * 来源：https://elements.ai-sdk.dev/components/model-selector（MIT，Vercel）。
 * 浮层沿用项目 Popover，搜索、方向键和选中管理交给 cmdk。
 */
import { Command } from "cmdk";
import { Search } from "lucide-react";
import type { ComponentProps } from "react";
export function ModelSelector({ children, ...props }: ComponentProps<typeof Command>) {
  return (
    <Command {...props} className="flex min-h-0 flex-col text-label">
      {children}
    </Command>
  );
}
export function ModelSelectorInput(props: ComponentProps<typeof Command.Input>) {
  return (
    <div className="flex items-center gap-1.5 border-b border-separator px-2.5">
      <Search aria-hidden="true" className="size-3.5 text-muted-foreground" />
      <Command.Input
        {...props}
        className="h-9 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
export function ModelSelectorList(props: ComponentProps<typeof Command.List>) {
  return (
    <Command.List {...props} className="max-h-72 min-h-0 overflow-y-auto overscroll-contain p-1" />
  );
}
export function ModelSelectorEmpty(props: ComponentProps<typeof Command.Empty>) {
  return (
    <Command.Empty
      {...props}
      className="px-3 py-8 text-center text-caption text-muted-foreground"
    />
  );
}
export function ModelSelectorGroup(props: ComponentProps<typeof Command.Group>) {
  return (
    <Command.Group
      {...props}
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:text-muted-foreground"
    />
  );
}
export function ModelSelectorItem(props: ComponentProps<typeof Command.Item>) {
  return (
    <Command.Item
      {...props}
      className="flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-control px-2 outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-control-hover"
    />
  );
}
