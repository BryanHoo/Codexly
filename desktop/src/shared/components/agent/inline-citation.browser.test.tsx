import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import { InlineCitation } from "@codexly/ui/agent/inline-citation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { MessageResponse } from "./message-response.js";
import "../../styles/globals.css";

const openExternalUrl = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../../platform/tauri/external-url.js", () => ({ openExternalUrl }));

afterEach(async () => {
  openExternalUrl.mockClear();
  await page.viewport(1440, 900);
});

describe("来源引用交互", () => {
  it("悬停预览，点击外部关闭，键盘聚焦与 Escape 可操作", async () => {
    const screen = await render(<>
      <InlineCitation href="https://www.example.com/guide" newTabLabel="在新窗口中打开">
        官方文档
      </InlineCitation>
      <button>外部区域</button>
    </>);
    const trigger = screen.getByRole("button", { name: "example.com 官方文档" });
    await trigger.hover();
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
    await expect.element(screen.getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
    await expect.element(screen.getByRole("link")).toHaveAttribute("target", "_blank");
    await screen.getByRole("button", { name: "外部区域" }).click();
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
    (trigger.element() as HTMLElement).focus();
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
    await userEvent.tab();
    await expect.element(screen.getByRole("link")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
    await expect.element(trigger).toHaveFocus();
  });

  it("窄屏点击展开长来源，链接走桌面系统浏览器", async () => {
    await page.viewport(390, 720);
    const url = `https://example.com/${"very-long-source-".repeat(30)}`;
    const screen = await render(
      <MessageResponse mode="static">{`来源 [使用指南](${url})`}</MessageResponse>,
    );
    const trigger = screen.getByRole("button", { name: "example.com 使用指南" });
    // 无 pointerenter 的点击模拟触屏路径，不能靠悬停替点击提前打开浮层。
    (trigger.element() as HTMLElement).click();
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
    const link = screen.getByRole("link");
    const card = link.element().closest('[data-slot="hover-card-content"]') as HTMLElement;
    expect(card.getBoundingClientRect().width).toBeLessThanOrEqual(358);
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    await link.click();
    expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith(url);
  });

  it("链接跨分片闭合后显示引用，继续输出和结束时保留历史节点", async () => {
    const buffer = new AppendOnlyTextBuffer("首段正文\n\n参见 [官方文档](https://");
    const screen = await render(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" isAnimating />);
    const first = screen.container.querySelector("p");
    expect(screen.container.querySelector("[data-inline-citation]")).toBeNull();
    buffer.append("www.example.com/guide)");
    await screen.rerender(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" isAnimating />);
    const trigger = screen.getByRole("button", { name: "example.com 官方文档" });
    await trigger.click();
    const citation = trigger.element();
    const link = screen.getByRole("link").element();
    buffer.append("\n\n继续正文");
    await screen.rerender(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" isAnimating />);
    expect(screen.container.querySelector("p")).toBe(first);
    expect(trigger.element()).toBe(citation);
    expect(screen.getByRole("link").element()).toBe(link);
    await screen.rerender(<MessageResponse textSource={buffer.getSnapshot()} mode="static" isAnimating={false} />);
    expect(trigger.element()).toBe(citation);
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("没有标题时回退域名，保留图片链接的可见内容", async () => {
    const screen = await render(<>
      <InlineCitation href="https://example.com" newTabLabel="在新窗口中打开" />
      <InlineCitation href="https://example.org" newTabLabel="在新窗口中打开">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="图片来源" />
      </InlineCitation>
    </>);
    await screen.getByRole("button", { name: "example.com" }).click();
    await expect.element(screen.getByText("example.com", { exact: true }).last()).toBeVisible();
    await expect.element(screen.getByRole("img", { name: "图片来源" })).toBeVisible();
    expect(screen.getByRole("img", { name: "图片来源" }).element().closest(".sr-only")).toBeNull();
  });
});
