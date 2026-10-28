import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { Context, ContextTrigger } from "./context.js";
import "../../styles/globals.css";

it("上下文用量支持再次点击关闭，并保留外部点击关闭行为", async () => {
  const screen = await render(<>
    <Context maxTokens={1000} usedTokens={130}>
      <ContextTrigger data-testid="usage" />
    </Context>
    <button>外部区域</button>
  </>);
  const trigger = screen.getByTestId("usage");
  await trigger.hover();
  await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => document.querySelector('[data-slot="hover-card-content"]')).not.toBeNull();
  // 真正的驱动点击包含 pointerdown；不能用 DOM click 跳过浮层的外部点击处理。
  await trigger.click();
  await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => document.querySelector('[data-slot="hover-card-content"]')).toBeNull();
  // 显式离开再悬停，避免把已经由悬停打开的状态误判为一次点击的初始关闭状态。
  await screen.getByRole("button", { name: "外部区域" }).hover();
  await trigger.hover();
  await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
  await screen.getByRole("button", { name: "外部区域" }).click();
  await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
});
