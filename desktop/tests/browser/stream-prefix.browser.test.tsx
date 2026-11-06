import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { MessageResponse as WebResponse } from "../../../apps/web/src/shared/components/agent/message-response.js";
import { MessageResponse as DesktopResponse } from "../../src/shared/components/agent/message-response.js";
import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";

for (const [name, Response] of [["Web", WebResponse], ["桌面", DesktopResponse]] as const) {
  it(`${name} 长段落流式追加时不把首字单独渲染成一段`, async () => {
    const buffer = new AppendOnlyTextBuffer("我");
    const screen = await render(<Response textSource={buffer.getSnapshot()} mode="streaming" isAnimating />);
    buffer.append("已定位问题，**补丁格式需要保留上下文**。".repeat(500));
    await screen.rerender(<Response textSource={buffer.getSnapshot()} mode="streaming" isAnimating />);
    expect([...screen.container.querySelectorAll("p")].some((p) => p.textContent === "我")).toBe(false);
    expect(screen.container.textContent).toBe(buffer.materialize());
    await screen.rerender(<Response textSource={buffer.getSnapshot()} mode="static" isAnimating={false} />);
    await expect.poll(() => screen.container.querySelector("[data-streaming-markdown-preview]")).toBeNull();
    expect(screen.container.querySelectorAll("p")).toHaveLength(1);
    expect(screen.container.textContent).toBe(buffer.materialize().replaceAll("**", ""));
  });
  it(`${name} 单字前缀在最终回复替换后不残留`, async () => {
    const buffer = new AppendOnlyTextBuffer("我");
    const screen = await render(<Response textSource={buffer.getSnapshot()} mode="streaming" isAnimating />);
    buffer.append("先检查问题。\n\n");
    await screen.rerender(<Response textSource={buffer.getSnapshot()} mode="streaming" isAnimating />);
    const final = new AppendOnlyTextBuffer("已定位并复现，是 **Web 端处理 diff 的缺陷**。\n\n解释正文。");
    await screen.rerender(<Response textSource={final.getSnapshot()} mode="static" isAnimating={false} />);
    expect(screen.container.textContent).not.toContain("我");
    expect(screen.container.querySelector("p")?.textContent).toBe("已定位并复现，是 Web 端处理 diff 的缺陷。");
  });
}
