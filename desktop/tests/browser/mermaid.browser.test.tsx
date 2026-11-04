import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import { MessageResponse as DesktopResponse } from "../../src/shared/components/agent/message-response.js";
import { MessageResponse as WebResponse } from "../../../apps/web/src/shared/components/agent/message-response.js";

const diagram = `flowchart LR
    A[AI 修改] --> C[文档命令与校验]
    B[属性面板 / 排序 / 拖拽] --> C
    C --> D[统一页面文档]
    D --> E[编辑画布]
    D --> F[json-render 运行预览]
    D --> G[保存与发布]`;

describe.each([
  ["桌面", DesktopResponse],
  ["Web", WebResponse],
] as const)("%s Mermaid 实际渲染", (_, Response) => {
  it("将截图中的中文流程图渲染成 SVG", async () => {
    const screen = await render(
      <Response mode="static">{`\`\`\`mermaid\n${diagram}\n\`\`\``}</Response>,
    );
    await expect
      .poll(
        () =>
          screen.container.querySelector('[data-streamdown="mermaid-block"] svg[id]')?.textContent,
      )
      .toContain("统一页面文档");
    expect(screen.container.querySelector('[data-language="mermaid"]')).toBeNull();
  });

  it("流式围栏闭合和回合结束后保留图表", async () => {
    const buffer = new AppendOnlyTextBuffer("```mermaid\nflowchart LR\nA[开始] --> B[完成]");
    const screen = await render(<Response mode="streaming" textSource={buffer.getSnapshot()} />);
    buffer.append("\n```\n");
    await screen.rerender(<Response mode="streaming" textSource={buffer.getSnapshot()} />);
    await expect
      .poll(
        () =>
          screen.container.querySelector('[data-streamdown="mermaid-block"] svg[id]')?.textContent,
      )
      .toContain("完成");
    await screen.rerender(
      <Response mode="static" textSource={buffer.getSnapshot()} isAnimating={false} />,
    );
    await expect
      .poll(
        () =>
          screen.container.querySelector('[data-streamdown="mermaid-block"] svg[id]')?.textContent,
      )
      .toContain("完成");
  });
});
