import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { ImagePreview as WebImagePreview } from "../../../../../apps/web/src/shared/components/core/image-preview.js";
import { changeAppLanguage } from "../../../i18n/i18n.js";
import { ImagePreview } from "./image-preview.js";
import { TooltipProvider } from "./tooltip.js";
import "../../styles/globals.css";

const imageUrl = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#22c55e"/><circle cx="600" cy="300" r="120" fill="#ef4444"/></svg>')}`;

beforeEach(async () => {
  await changeAppLanguage("zh-CN");
});

function dispatchTouch(target: HTMLElement, type: string, points: readonly [number, number][]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  // 用同一组触点数据驱动两个浏览器的原生触摸事件监听器。
  Object.defineProperty(event, "touches", {
    value: points.map(([clientX, clientY], identifier) => ({
      clientX,
      clientY,
      pageX: clientX,
      pageY: clientY,
      identifier,
      target,
    })),
  });
  target.dispatchEvent(event);
}

test.each([
  ["desktop", ImagePreview, 800],
  ["web-mobile", WebImagePreview, 320],
] as const)("%s 支持滚轮、拖动、双击、双指缩放和容器复位", async (name, Preview, width) => {
  await page.viewport(width, 700);
  const screen = await render(
    <TooltipProvider>
      <div style={{ width, height: 480 }}>
        <Preview alt="fixture" src={imageUrl} />
      </div>
    </TooltipProvider>,
  );
  await expect.element(screen.getByRole("button", { name: "放大图片" })).toBeEnabled();
  const image = screen.getByRole("img", { name: "fixture" }).element();
  const wrapper = image.closest<HTMLElement>(".react-transform-wrapper")!;
  const bounds = wrapper.getBoundingClientRect();
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const initial = image.getBoundingClientRect();

  await screen.getByRole("button", { name: "原始尺寸" }).click();
  await expect
    .poll(() => {
      const rect = image.getBoundingClientRect();
      return Math.min(rect.width, rect.height * 2);
    })
    .toBeCloseTo(1200, 0);
  await screen.getByRole("button", { name: "适应容器" }).click();

  wrapper.dispatchEvent(
    new WheelEvent("wheel", {
      deltaY: -120,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
  await expect.poll(() => image.getBoundingClientRect().width).toBeGreaterThan(initial.width);
  const zoomed = image.getBoundingClientRect();
  wrapper.dispatchEvent(
    new MouseEvent("mousedown", { button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true }),
  );
  window.dispatchEvent(
    new MouseEvent("mousemove", { buttons: 1, clientX: x + 60, clientY: y + 40, bubbles: true }),
  );
  window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  await expect.poll(() => image.getBoundingClientRect().x).toBeCloseTo(zoomed.x + 60, 0);
  await expect.poll(() => image.getBoundingClientRect().y).toBeCloseTo(zoomed.y + 40, 0);

  await screen.getByRole("button", { name: "适应容器" }).click();
  await expect.poll(() => image.getBoundingClientRect().width).toBeCloseTo(initial.width, 0);
  wrapper.dispatchEvent(new MouseEvent("dblclick", { clientX: x, clientY: y, bubbles: true }));
  await expect.poll(() => image.getBoundingClientRect().width).toBeGreaterThan(initial.width);
  await screen.getByRole("button", { name: "适应容器" }).click();

  dispatchTouch(wrapper, "touchstart", [
    [x - 40, y],
    [x + 40, y],
  ]);
  dispatchTouch(wrapper, "touchmove", [
    [x - 80, y],
    [x + 80, y],
  ]);
  dispatchTouch(wrapper, "touchend", []);
  await expect.poll(() => image.getBoundingClientRect().width).toBeGreaterThan(initial.width);
  const pinched = image.getBoundingClientRect();
  dispatchTouch(wrapper, "touchstart", [[x, y]]);
  dispatchTouch(wrapper, "touchmove", [[x + 30, y + 20]]);
  dispatchTouch(wrapper, "touchend", []);
  await expect.poll(() => image.getBoundingClientRect().x).toBeCloseTo(pinched.x + 30, 0);
  await screen.getByRole("button", { name: "适应容器" }).click();
  await expect.poll(() => image.getBoundingClientRect().width).toBeCloseTo(initial.width, 0);

  expect(wrapper.clientWidth).toBe(width);
  expect(wrapper.clientHeight).toBe(444);
  expect(
    screen.getByRole("button", { name: "原始尺寸" }).element().getBoundingClientRect().bottom,
  ).toBeLessThanOrEqual(bounds.bottom + 36);
  await page.screenshot({ path: `../../../../test-results/image-preview-${name}.png` });
});

test("图片加载失败后切换资源可以恢复，切换图片和容器尺寸时复位", async () => {
  const fixture = (src: string, width = 600) => (
    <TooltipProvider>
      <div style={{ width, height: 400 }}>
        <ImagePreview alt="fixture" src={src} />
      </div>
    </TooltipProvider>
  );
  const screen = await render(fixture("data:image/png;base64,invalid"));
  await expect.element(screen.getByRole("alert")).toHaveTextContent("图片无法预览");
  await screen.rerender(fixture(imageUrl));
  await expect.element(screen.getByRole("button", { name: "放大图片" })).toBeEnabled();
  await screen.getByRole("button", { name: "放大图片" }).click();
  const image = screen.getByRole("img", { name: "fixture" }).element();
  await expect.poll(() => image.getBoundingClientRect().width).toBeGreaterThan(600);
  await screen.rerender(fixture(`${imageUrl}#next`));
  await expect.element(screen.getByRole("button", { name: "放大图片" })).toBeEnabled();
  await expect
    .poll(
      () => screen.getByRole("img", { name: "fixture" }).element().getBoundingClientRect().width,
    )
    .toBe(600);
  await screen.getByRole("button", { name: "放大图片" }).click();
  await screen.rerender(fixture(`${imageUrl}#next`, 360));
  await expect
    .poll(
      () => screen.getByRole("img", { name: "fixture" }).element().getBoundingClientRect().width,
    )
    .toBe(360);
});
