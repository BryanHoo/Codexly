import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ProjectSourcePanel as DesktopPanel } from "../../src/features/workbench/components/project-source-panel.js";
import { ProjectSourcePanel as WebPanel } from "../../../apps/web/src/features/workbench/components/project-source-panel.js";
import { TooltipProvider } from "../../src/shared/components/core/tooltip.js";
import "../../src/shared/styles/globals.css";

describe.each([
  ["桌面", DesktopPanel],
  ["Web", WebPanel],
] as const)("%s 文件查看长行", (_, Panel) => {
  it.each([
    [360, false],
    [1000, false],
    [360, true],
    [1000, true],
  ])("在 %ipx 容器内独立滚动，编辑模式 %s", async (width, editing) => {
    const content = Array.from(
      { length: 200 },
      (_, index) => `${index} 巡检报告 ${"long-content".repeat(300)} END`,
    ).join("\n");
    const client = {
      readProjectTextFile: vi.fn().mockResolvedValue({
        content,
        path: "report.txt",
        version: "a".repeat(64),
      }),
      readProjectSourceFile: vi.fn().mockResolvedValue({
        content,
        path: "report.txt",
        nextCursor: null,
      }),
    } as unknown as Parameters<typeof Panel>[0]["client"];
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={cache}>
        <TooltipProvider>
          <div
            data-preview-frame=""
            style={{
              width,
              height: 480,
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              gridTemplateRows: "minmax(0, 1fr)",
              colorScheme: width === 360 ? "light" : "dark",
            }}
          >
            <Panel
              client={client}
              projectId="project"
              previewKind="source"
              {...(editing ? { rootPath: "/workspace" } : {})}
              reference={{ path: "report.txt", lineNumber: null }}
              onClose={() => {}}
            />
          </div>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await expect
      .poll(
        () =>
          screen.container.querySelector(editing ? ".cm-line" : "[data-code-line]")?.textContent,
      )
      .toContain("巡检报告");
    // 等编辑器的测量帧完成，避免只验证尚未排版的初始 DOM。
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const frame = screen.container.querySelector<HTMLElement>("[data-preview-frame]")!;
    const header = frame.querySelector<HTMLElement>('[data-slot="code-block-header"]')!;
    const scroller = editing
      ? frame.querySelector<HTMLElement>(".cm-scroller")!
      : frame.querySelector("pre")!.parentElement!;
    expect(frame.scrollWidth).toBeLessThanOrEqual(width + 1);
    expect(scroller.clientWidth).toBeLessThanOrEqual(width);
    expect(scroller.clientWidth).toBeGreaterThan(width - 40);
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    const headerLeft = header.getBoundingClientRect().left;
    scroller.scrollLeft = scroller.scrollWidth;
    scroller.scrollTop = 800;
    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0);
    expect(scroller.scrollLeft).toBeGreaterThan(0);
    // 虚拟行比 pre 更宽；只读背景由滚动视口绘制，编辑背景由固定的编辑器外框绘制。
    const background = editing ? frame.querySelector(".cm-editor")! : scroller;
    expect(getComputedStyle(background).backgroundColor).toBe(
      getComputedStyle(frame.querySelector(".file-theme")!).backgroundColor,
    );
    expect(getComputedStyle(background).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(header.getBoundingClientRect().left).toBe(headerLeft);
    expect(frame.querySelectorAll("[data-code-line]").length).toBeLessThan(100);
    cache.clear();
  });
});
