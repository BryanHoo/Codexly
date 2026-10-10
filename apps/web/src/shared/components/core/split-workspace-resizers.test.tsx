import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createSplitLayout } from "@codexly/frontend-core/split-layout";
import { SplitWorkspaceResizers } from "@codexly/ui/core/split-workspace-resizers";

describe("共享分屏分割线", () => {
  it("为四屏提供一个宽度和两个局部高度分割线，并允许键盘聚焦", () => {
    const layout = createSplitLayout(["one", "two", "three", "four"]);
    if (layout === undefined) throw new Error("测试所需的分屏布局不存在");
    const markup = renderToStaticMarkup(
      <SplitWorkspaceResizers
        layout={layout}
        containerRef={createRef<HTMLDivElement>()}
        resize={() => undefined}
        widthLabel="调整分屏宽度"
        heightLabel="调整分屏高度"
      />,
    );
    expect(markup.match(/role="separator"/gu)).toHaveLength(3);
    expect(markup.match(/tabindex="0"/gu)).toHaveLength(3);
    expect(markup.match(/aria-label="调整分屏宽度"/gu)).toHaveLength(1);
    expect(markup.match(/aria-label="调整分屏高度"/gu)).toHaveLength(2);
    expect(markup).toContain('aria-orientation="vertical"');
    expect(markup).toContain('aria-orientation="horizontal"');
    expect(markup).toContain('aria-valuenow="50"');
  });
});
