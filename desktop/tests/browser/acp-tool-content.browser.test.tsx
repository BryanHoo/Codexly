import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { ToolOutput as WebOutput } from "../../../apps/web/src/shared/components/agent/tool.js";
import { ToolOutput as DesktopOutput } from "../../src/shared/components/agent/tool.js";
import "../../src/shared/styles/globals.css";

for (const [platform, Output] of [["Web", WebOutput], ["Desktop", DesktopOutput]] as const) {
  it.each([["light", 360], ["dark", 360], ["light", 960], ["dark", 960]] as const)(
    `${platform} 的 ACP 内容在 %s、%spx 下可阅读和键盘导航`,
    async (theme, width) => {
      document.documentElement.dataset.theme = theme;
      const uri = `https://example.com/${"long-path/".repeat(30)}`;
      const screen = await render(
        <div data-acp-content-test style={{ width }}>
          <Output errorText={undefined} output={[
            { type: "content", content: { type: "text", text: "第一行\n  第二行" } },
            { type: "content", content: { type: "resource_link", name: "检查报告", uri } },
          ]} />
        </div>,
      );
      try {
        const link = screen.getByRole("link", { name: "检查报告" });
        await expect.element(link).toBeVisible();
        expect(link.element().getAttribute("href")).toBe(uri);
        link.element().focus();
        await expect.element(link).toHaveFocus();
        const root = document.querySelector<HTMLElement>("[data-acp-content-test]");
        if (!root) throw new Error("测试内容未挂载");
        expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
        const text = root.querySelector(".whitespace-pre-wrap");
        if (!text) throw new Error("工具文本未挂载");
        expect(getComputedStyle(text).whiteSpace).toBe("pre-wrap");
        expect(text.textContent).toBe("第一行\n  第二行");
      } finally {
        await screen.unmount();
        delete document.documentElement.dataset.theme;
      }
    },
  );
}
