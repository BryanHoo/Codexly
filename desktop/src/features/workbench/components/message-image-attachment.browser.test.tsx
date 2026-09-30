import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { changeAppLanguage } from "../../../i18n/i18n.js";
import { MessageImageAttachment } from "./message-image-attachment.js";
import "../../../shared/styles/globals.css";

const imageUrl = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#22c55e"/></svg>')}`;

beforeEach(async () => {
  await changeAppLanguage("zh-CN");
});

test("图片弹窗支持放大、缩小、复位，重新打开时恢复完整图片", async () => {
  const screen = await render(
    <TooltipProvider>
      <MessageImageAttachment name="preview.png" url={imageUrl} />
    </TooltipProvider>,
  );
  await screen.getByRole("button", { name: "查看图片 preview.png" }).click();
  await expect.element(screen.getByRole("button", { name: "放大图片" })).toBeEnabled();
  const image = screen.getByRole("img", { name: "preview.png", exact: true }).element();
  // 等待弹窗入场变换结束，确保比较的是图片缩放而非弹窗动画。
  await expect.poll(() => image.getBoundingClientRect().width).toBeCloseTo(image.clientWidth, 0);
  const initialWidth = image.getBoundingClientRect().width;
  await screen.getByRole("button", { name: "放大图片", exact: true }).click();
  await expect.poll(() => image.getBoundingClientRect().width).toBeGreaterThan(initialWidth);
  await screen.getByRole("button", { name: "缩小图片", exact: true }).click();
  await screen.getByRole("button", { name: "适应容器", exact: true }).click();
  await expect.poll(() => image.getBoundingClientRect().width).toBeCloseTo(initialWidth, 0);
  await screen.getByRole("button", { name: "关闭图片预览", exact: true }).click();
  await screen.getByRole("button", { name: "查看图片 preview.png" }).click();
  await expect.element(screen.getByRole("button", { name: "放大图片" })).toBeVisible();
});
