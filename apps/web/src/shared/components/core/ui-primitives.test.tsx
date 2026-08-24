import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./button.js";
import { ButtonGroup } from "./button-group.js";
import { Checkbox } from "./checkbox.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./context-menu.js";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { Input } from "./input.js";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "./input-group.js";
import { Select, SelectTrigger, SelectValue } from "./select.js";
import { Sheet, SheetContent, SheetTitle } from "./sheet.js";
import { Textarea } from "./textarea.js";
import { Tooltip, TooltipProvider, TooltipTrigger } from "./tooltip.js";

describe("项目核心组件", () => {
  it("直接使用项目品牌与中性交互 Token", () => {
    const css = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");

    expect(css).toContain("--color-brand: var(--ui-color-accent);");
    expect(css).toContain("--color-control-hover: var(--ui-color-control-hover);");
    expect(css).toContain("--color-foreground: var(--ui-color-text);");
    expect(css).toContain("--ui-icon-size-default: 1rem;");
    expect(css).toContain(".lucide {");
    expect(css).toContain("height: var(--ui-icon-size-default);");
    expect(css).toContain("width: var(--ui-icon-size-default);");
    expect(css).not.toContain("--color-primary:");
    expect(css).not.toContain("--primary:");
  });

  it("renders project button and input slots with native attributes", () => {
    const markup = renderToStaticMarkup(
      <form>
        <Input aria-label="名称" name="name" />
        <Button type="submit">保存</Button>
      </form>,
    );

    expect(markup).toContain('data-slot="input"');
    expect(markup).toContain('aria-label="名称"');
    expect(markup).toContain('data-slot="button"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain("保存");
  });

  it("owns complete project visuals for buttons and text controls", () => {
    const markup = renderToStaticMarkup(
      <>
        <Button type="button">保存</Button>
        <Button type="button" variant="ghost">
          更多
        </Button>
        <Button contentAlign="start" type="button" variant="ghost">
          导航
        </Button>
        <Input aria-label="名称" />
        <Input aria-label="配对码" variant="embedded" />
        <Textarea aria-label="说明" />
      </>,
    );

    const buttonClasses = [...markup.matchAll(/<button class="([^"]+)"/gu)].map(
      (match) => match[1],
    );
    const inputClasses = [...markup.matchAll(/<input class="([^"]+)"/gu)].map((match) => match[1]);

    expect(buttonClasses[0]).toContain("inline-flex");
    expect(buttonClasses[0]).toContain("h-8");
    expect(buttonClasses[0]).toContain("bg-brand");
    expect(buttonClasses[1]).toContain("bg-transparent");
    expect(buttonClasses[1]).toContain("hover:bg-control-hover");
    expect(buttonClasses[2]).toContain("justify-start");
    expect(buttonClasses[2]).not.toContain("justify-center");
    expect(inputClasses[0]).toContain("h-9");
    expect(inputClasses[0]).toContain("bg-control");
    expect(inputClasses[1]).toContain("bg-transparent");
    expect(inputClasses[1]).not.toContain("bg-control");
    expect(/<textarea class="([^"]+)"/u.exec(markup)?.[1]).toContain("min-h-20");
  });

  it("统一约束工具栏 Select 内的图标尺寸", () => {
    const markup = renderToStaticMarkup(
      <Select defaultValue="primary">
        <SelectTrigger aria-label="选择目录" size="toolbar">
          <SelectValue>primary</SelectValue>
        </SelectTrigger>
      </Select>,
    );
    const triggerClasses = /data-slot="select-trigger"[^>]*class="([^"]+)"/u.exec(markup)?.[1];

    expect(markup).toContain('data-size="toolbar"');
    expect(triggerClasses).toContain("h-6");
    expect(triggerClasses).toContain("text-caption");
    expect(triggerClasses).toContain("size-3");
    expect(triggerClasses).not.toContain("size-4");
  });

  it("composes a one-row multiline input with an inline action", () => {
    const markup = renderToStaticMarkup(
      <InputGroup>
        <InputGroupTextarea aria-label="提交信息" rows={1} value={"标题\n正文"} readOnly />
        <InputGroupAddon align="inline-end">
          <Button type="button">生成</Button>
        </InputGroupAddon>
      </InputGroup>,
    );

    expect(markup).toContain('data-slot="input-group"');
    expect(markup).toContain('data-slot="input-group-control"');
    expect(markup).toContain('data-slot="input-group-addon"');
    expect(markup).toContain("bg-transparent");
    expect(markup).toContain("标题\n正文");
  });

  it("composes tooltip and dialog triggers without replacing their button DOM", () => {
    const tooltipMarkup = renderToStaticMarkup(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">提示</button>
          </TooltipTrigger>
        </Tooltip>
      </TooltipProvider>,
    );
    const dialogMarkup = renderToStaticMarkup(
      <Dialog>
        <DialogTrigger asChild>
          <button type="button">打开</button>
        </DialogTrigger>
      </Dialog>,
    );

    expect(tooltipMarkup.match(/<button/gu)).toHaveLength(1);
    expect(tooltipMarkup).toContain('data-slot="tooltip-trigger"');
    expect(dialogMarkup.match(/<button/gu)).toHaveLength(1);
    expect(dialogMarkup).toContain('data-slot="dialog-trigger"');
  });

  it("keeps dialog content inside the dynamic viewport", () => {
    const markup = renderToStaticMarkup(
      <Dialog open>
        <DialogContent aria-labelledby="dialog-title">
          <DialogTitle id="dialog-title">设置</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(markup).toContain("min-w-0");
    expect(markup).toContain("w-[calc(100%-2rem)]");
  });

  it("renders the project sheet and controlled checkbox primitives", () => {
    const markup = renderToStaticMarkup(
      <Sheet open>
        <SheetContent aria-labelledby="sheet-title" side="right">
          <SheetTitle id="sheet-title">提交变更</SheetTitle>
          <Checkbox aria-label="选择文件" checked />
          <Checkbox aria-label="部分选择" checked="indeterminate" />
        </SheetContent>
      </Sheet>,
    );

    expect(markup).toContain('data-slot="sheet-content"');
    expect(markup).toContain("inset-y-0 right-0");
    expect(markup).toContain('data-slot="checkbox"');
    expect(markup).toContain('aria-label="选择文件"');
    expect(markup).toContain('data-state="checked"');
    expect(markup).toContain('aria-checked="mixed"');
    expect(markup).toContain("data-[state=indeterminate]:bg-brand");
  });

  it("renders the project collapsible primitive with trigger and content slots", () => {
    const markup = renderToStaticMarkup(
      <Collapsible defaultOpen>
        <CollapsibleTrigger>变更</CollapsibleTrigger>
        <CollapsibleContent>文件列表</CollapsibleContent>
      </Collapsible>,
    );

    expect(markup).toContain('data-slot="collapsible"');
    expect(markup).toContain('data-slot="collapsible-trigger"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('data-slot="collapsible-content"');
    expect(markup).toContain("文件列表");
  });

  it("composes a portalled dropdown menu without replacing the trigger button", () => {
    const markup = renderToStaticMarkup(
      <DropdownMenu open>
        <DropdownMenuTrigger asChild>
          <button type="button">更多</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="操作菜单">
          <DropdownMenuItem className="text-danger">删除</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(markup.match(/<button/gu)).toHaveLength(1);
    expect(markup).toContain('data-slot="dropdown-menu-trigger"');
    expect(markup).toContain('data-slot="dropdown-menu-content"');
    expect(markup).toContain('data-slot="dropdown-menu-item"');
    expect(markup).toContain("text-danger");
  });

  it("renders dropdown radio choices inside a button group", () => {
    const groupMarkup = renderToStaticMarkup(
      <ButtonGroup>
        <button type="button">打开</button>
        <button type="button">选择应用</button>
      </ButtonGroup>,
    );
    const menuMarkup = renderToStaticMarkup(
      <DropdownMenu open>
        <DropdownMenuContent aria-label="选择应用">
          <DropdownMenuRadioGroup value="zed">
            <DropdownMenuRadioItem value="zed">Zed</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(groupMarkup).toContain('data-slot="button-group"');
    expect(groupMarkup).toContain('role="group"');
    expect(menuMarkup).toContain('data-slot="dropdown-menu-radio-group"');
    expect(menuMarkup).toContain('data-slot="dropdown-menu-radio-item"');
    expect(menuMarkup).toContain('role="menuitemradio"');
  });

  it("renders nested dropdown choices with a trailing check indicator", () => {
    const markup = renderToStaticMarkup(
      <DropdownMenu open>
        <DropdownMenuContent aria-label="模型和思考量">
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger>模型</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value="gpt-5.6-sol">
                <DropdownMenuRadioItem indicator="check" value="gpt-5.6-sol">
                  GPT-5.6 Sol
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(markup).toContain('data-slot="dropdown-menu-sub-trigger"');
    expect(markup).toContain('data-slot="dropdown-menu-sub-content"');
    expect(markup).toContain('data-indicator="check"');
    expect(markup).toContain('data-indicator-position="end"');
    expect(markup).toContain('role="menuitemradio"');
  });

  it("composes a portalled context menu around its existing trigger DOM", () => {
    const markup = renderToStaticMarkup(
      <ContextMenu open>
        <ContextMenuTrigger asChild>
          <div aria-selected="false" role="treeitem">
            README.md
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent aria-label="打开 README.md 的方式">
          <ContextMenuLabel>打开方式</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem>Zed</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    expect(markup.match(/role="treeitem"/gu)).toHaveLength(1);
    expect(markup).toContain('data-slot="context-menu-trigger"');
    expect(markup).toContain('data-slot="context-menu-content"');
    expect(markup).toContain('data-slot="context-menu-label"');
    expect(markup).toContain('data-slot="context-menu-separator"');
    expect(markup).toContain('data-slot="context-menu-item"');
  });
});
