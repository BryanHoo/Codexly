import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import { MessageResponse as DesktopResponse } from "../../src/shared/components/agent/message-response.js";
import { MessageResponse as WebResponse } from "../../../apps/web/src/shared/components/agent/message-response.js";
import "../../src/shared/styles/globals.css";
import { page, userEvent } from "vitest/browser";

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
  it.each([375, 960])("图表直接展示，工具栏同排且不挤占画布（%s px）", async (width) => {
    await page.viewport(width, 800);
    const screen = await render(
      <Response mode="static">{`\`\`\`mermaid\n${diagram}\n\`\`\``}</Response>,
    );
    await expect
      .poll(() => screen.container.querySelector('[data-streamdown="mermaid"] svg[id]'), {
        timeout: 10_000,
      })
      .toBeTruthy();
    const block = screen.container.querySelector('[data-streamdown="mermaid-block"]')!;
    const svg = block.querySelector("svg[id]")!;
    expect(svg.getBoundingClientRect().width).toBeGreaterThan(
      Math.min(400, block.getBoundingClientRect().width - 18) * 0.9,
    );
    const actions = block.querySelector('[data-streamdown="mermaid-block-actions"]')!;
    const header = block.firstElementChild!;
    const headerBox = header.getBoundingClientRect();
    const actionsBox = actions.getBoundingClientRect();
    expect(
      Math.abs(headerBox.top + headerBox.height / 2 - actionsBox.top - actionsBox.height / 2),
    ).toBeLessThanOrEqual(1);
    expect(actionsBox.height).toBeLessThanOrEqual(32);
    expect(actionsBox.right).toBeLessThanOrEqual(block.getBoundingClientRect().right - 8);
    // 图表正文紧跟唯一标题行，工具层不再占据第二行或形成嵌套边框。
    const body = block.lastElementChild!;
    expect(body.getBoundingClientRect().top - headerBox.bottom).toBeLessThanOrEqual(8);
    expect(getComputedStyle(body).borderTopWidth).toBe("0px");
    const zoom = block.querySelector('button[title="Zoom in"]')!;
    expect(getComputedStyle(zoom.parentElement!).position).toBe("absolute");
    const canvas = block.querySelector('[role="application"]') as HTMLElement;
    const originalTransform = canvas.style.transform;
    await userEvent.click(zoom);
    expect(canvas.style.transform).not.toBe(originalTransform);
    await userEvent.click(block.querySelector('button[title="Reset zoom and pan"]')!);
    expect(canvas.style.transform).toBe(originalTransform);
    await userEvent.click(actions.querySelector('button[title="View fullscreen"]')!);
    await expect.poll(() => document.querySelector('button[title="Exit fullscreen"]')).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector('button[title="Exit fullscreen"]')).toBeNull();
    await page.viewport(1440, 900);
  });

  it("将截图中的中文流程图渲染成 SVG", async () => {
    const screen = await render(
      <Response mode="static">{`\`\`\`mermaid\n${diagram}\n\`\`\``}</Response>,
    );
    await expect
      .poll(
        () =>
          screen.container.querySelector('[data-streamdown="mermaid-block"] svg[id]')?.textContent,
        // 首张图表需要异步加载并初始化 Mermaid，不能套用默认 1 秒轮询窗口。
        { timeout: 10_000 },
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
