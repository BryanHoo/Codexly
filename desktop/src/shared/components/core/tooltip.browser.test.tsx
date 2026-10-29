import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { Button } from "./button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import * as desktopTooltip from "./tooltip.js";
import * as webTooltip from "../../../../../apps/web/src/shared/components/core/tooltip.js";
import "../../styles/globals.css";

afterEach(async () => {
  await page.viewport(1440, 900);
});

for (const [platform, components] of [
  ["desktop", desktopTooltip],
  ["web", webTooltip],
] as const) {
  it(`${platform}: keyboard focus opens a tooltip and Escape dismisses it`, async () => {
    const { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } = components;
    const onFocus = vi.fn();
    const onChildFocus = vi.fn();
    const onOpenChange = vi.fn();
    const screen = await render(
      <TooltipProvider delayDuration={0}>
        <Tooltip onOpenChange={onOpenChange}>
          <TooltipTrigger asChild onFocus={onFocus}>
            <button onFocus={onChildFocus} type="button">
              Action
            </button>
          </TooltipTrigger>
          <TooltipContent>Action details</TooltipContent>
        </Tooltip>
        <button type="button">Other</button>
      </TooltipProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Action", exact: true });
    await userEvent.keyboard("{Tab}");
    // macOS WebKit 的 Tab 顺序受系统设置影响；先切换键盘模态，再显式定位目标。
    (trigger.element() as HTMLElement).focus();
    await expect.element(trigger).toHaveFocus();
    await expect.element(screen.getByRole("tooltip")).toBeVisible();
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onChildFocus).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("tooltip")).not.toBeInTheDocument();
    const other = screen.getByRole("button", { name: "Other" });
    await other.click();
    (other.element() as HTMLElement).focus();
    (trigger.element() as HTMLElement).focus();
    await expect.element(trigger).toHaveFocus();
    await expect.element(screen.getByRole("tooltip")).not.toBeInTheDocument();
  });

  it(`${platform}: tooltip content stays open while hovered`, async () => {
    const { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } = components;
    const screen = await render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">Hover action</button>
          </TooltipTrigger>
          <TooltipContent>Hover details</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await screen.getByRole("button", { name: "Hover action" }).hover();
    const popup = screen.getByRole("tooltip");
    await expect.element(popup).toBeVisible();
    // 可悬停内容必须参与命中测试，否则鼠标从按钮移向提示时会立刻丢失内容。
    expect(getComputedStyle(popup.element()).pointerEvents).not.toBe("none");
    await popup.hover();
    await expect.element(popup).toBeVisible();
  });

  it(`${platform}: a local delay override preserves instant switching within the provider`, async () => {
    const { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } = components;
    const screen = await render(
      <TooltipProvider delayDuration={60_000} skipDelayDuration={60_000}>
        <Tooltip delayDuration={0}>
          <TooltipTrigger>First action</TooltipTrigger>
          <TooltipContent>First hint</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>Adjacent action</TooltipTrigger>
          <TooltipContent>Adjacent hint</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    // 若局部延迟误建独立 Provider，第二个提示将等待 60 秒，而非沿用分组的即时阶段。
    await screen.getByRole("button", { name: "First action" }).hover();
    await expect.element(screen.getByRole("tooltip")).toHaveTextContent("First hint");
    await screen.getByRole("button", { name: "Adjacent action" }).hover();
    await expect.element(screen.getByRole("tooltip")).toHaveTextContent("Adjacent hint");
  });

  it(`${platform}: render and asChild preserve refs, button DOM and click handlers`, async () => {
    const { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } = components;
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    const onTriggerClick = vi.fn();
    const screen = await render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger asChild onClick={onTriggerClick}>
            <Button ref={ref} onClick={onClick} type="button">
              Existing action
            </Button>
          </TooltipTrigger>
          <TooltipContent>Existing hint</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button type="button" />}>New action</TooltipTrigger>
          <TooltipContent>New hint</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    const existing = screen.getByRole("button", { name: "Existing action" });
    expect(ref.current).toBe(existing.element());
    expect(document.querySelectorAll("button")).toHaveLength(2);
    await existing.hover();
    await expect.element(screen.getByRole("tooltip")).toHaveTextContent("Existing hint");
    await existing.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(onTriggerClick).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole("tooltip")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "New action" }).hover();
    await expect.element(screen.getByRole("tooltip")).toHaveTextContent("New hint");
  });

  it(`${platform}: a span wrapper can show a hint for a disabled button`, async () => {
    const { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } = components;
    const onClick = vi.fn();
    const screen = await render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" data-testid="disabled-wrapper" />}>
            <Button disabled onClick={onClick} type="button">
              Unavailable
            </Button>
          </TooltipTrigger>
          <TooltipContent>Requires a connection</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await screen.getByTestId("disabled-wrapper").hover();
    await expect.element(screen.getByRole("tooltip")).toHaveTextContent("Requires a connection");
    await expect.element(screen.getByRole("button", { name: "Unavailable" })).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it(`${platform}: composing a Radix menu keeps actions and restored focus working`, async () => {
    const { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } = components;
    const onSelect = vi.fn();
    const screen = await render(
      <TooltipProvider delay={0}>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button type="button">More actions</Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Open actions</TooltipContent>
          </Tooltip>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onSelect}>Run action</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>,
    );
    const trigger = screen.getByRole("button", { name: "More actions" });
    await trigger.hover();
    await expect.element(screen.getByRole("tooltip")).toBeVisible();
    await trigger.click();
    await expect.element(screen.getByRole("menu")).toBeVisible();
    await expect.element(screen.getByRole("tooltip")).not.toBeInTheDocument();
    await screen.getByRole("menuitem", { name: "Run action" }).click();
    expect(onSelect).toHaveBeenCalledOnce();
    await expect.element(trigger).toHaveFocus();
    await expect.element(screen.getByRole("tooltip")).not.toBeInTheDocument();
  });

  for (const width of [375, 1440]) {
    it(`${platform}: long hints escape clipping and stay within a ${width}px viewport`, async () => {
      await page.viewport(width, 800);
      const { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } = components;
      const screen = await render(
        <TooltipProvider delay={0}>
          <div
            data-testid="clipped"
            style={{ position: "fixed", top: 2, right: 2, overflow: "hidden" }}
          >
            <Tooltip>
              <TooltipTrigger render={<Button type="button" />}>Edge action</TooltipTrigger>
              <TooltipContent side="top">{`文件路径/${"very-long-path-".repeat(30)}`}</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>,
      );
      await screen.getByRole("button", { name: "Edge action" }).hover();
      const popup = screen.getByRole("tooltip");
      await expect.element(popup).toBeVisible();
      await expect.poll(() => getComputedStyle(popup.element()).opacity).toBe("1");
      const element = popup.element();
      const bounds = element.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(7);
      expect(bounds.right).toBeLessThanOrEqual(width - 7);
      expect(bounds.top).toBeGreaterThanOrEqual(7);
      expect(bounds.bottom).toBeLessThanOrEqual(793);
      expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
      expect(element.getAttribute("data-side")).toBe("bottom");
      expect(screen.getByTestId("clipped").element().contains(element)).toBe(false);
      expect(element.querySelector('[data-slot="tooltip-arrow"]')).not.toBeNull();
    });
  }
}
