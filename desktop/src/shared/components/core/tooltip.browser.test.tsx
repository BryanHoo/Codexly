import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import * as desktopTooltip from "./tooltip.js";
import * as webTooltip from "../../../../../apps/web/src/shared/components/core/tooltip.js";

for (const [platform, components] of [
  ["desktop", desktopTooltip],
  ["web", webTooltip],
] as const) {
  it(`${platform}: focus and restored focus do not open tooltips, hover still does`, async () => {
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
    (trigger.element() as HTMLElement).focus();
    await expect.element(trigger).toHaveFocus();
    await expect.element(trigger).toHaveAttribute("data-state", "closed");
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onChildFocus).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();

    await trigger.hover();
    await expect.element(screen.getByRole("tooltip")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("tooltip")).not.toBeInTheDocument();
    const other = screen.getByRole("button", { name: "Other" });
    await other.hover();
    (other.element() as HTMLElement).focus();
    (trigger.element() as HTMLElement).focus();
    await expect.element(trigger).toHaveFocus();
    await expect.element(trigger).toHaveAttribute("data-state", "closed");
  });
}
