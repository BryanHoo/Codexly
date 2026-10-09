import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SplitComposer } from "@codexly/ui/core/split-composer";
import { SplitPaneContext } from "@codexly/ui/core/split-workspace";

function renderComposer(multiple: boolean, interruptible = false, collapsible = true) {
  return renderToStaticMarkup(
    <SplitPaneContext
      value={{
        pane: { projectId: "project", taskId: "task" },
        active: true,
        multiple,
        sidebarOpen: false,
        toggleSidebar: () => undefined,
      }}
    >
      <SplitComposer
        collapsible={collapsible}
        label="聊天输入"
        expandLabel="展开输入框"
        collapseLabel="收起输入框"
        stopLabel="停止生成"
        interruptible={interruptible}
        onInterrupt={() => undefined}
        notice={<p>请回答待确认问题</p>}
        footer={(controls) => <footer>分支、项目路径、上下文{controls}</footer>}
      >
        <textarea data-prompt-skill-editor="" defaultValue="保留草稿" />
      </SplitComposer>
    </SplitPaneContext>,
  );
}

describe("分屏输入框", () => {
  it("分屏默认收起，隐藏内容保留在 DOM 且不可聚焦", () => {
    const markup = renderComposer(true);
    expect(markup).toContain('aria-label="展开输入框"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('hidden="" inert=""');
    expect(markup).toContain("保留草稿</textarea>");
    const contentId = /aria-controls="([^"]+)"/.exec(markup)?.[1];
    expect(contentId).toBeTruthy();
    if (contentId === undefined) throw new Error("缺少输入区域关联 ID");
    expect(markup).toContain(`id="${contentId}"`);
    // 待回答问题留在隐藏边界外，避免收起输入框阻碍任务继续。
    expect(markup.indexOf("请回答待确认问题")).toBeLessThan(markup.indexOf('hidden=""'));
    expect(markup).toContain("</textarea></div><footer>分支、项目路径、上下文");
    expect(markup.indexOf("<footer>")).toBeLessThan(markup.indexOf('aria-expanded="false"'));
  });

  it("单窗口和移动端直接展示输入框，不提供收起按钮", () => {
    const markup = renderComposer(false);
    expect(markup).toContain("保留草稿</textarea>");
    expect(markup).not.toContain('hidden=""');
    expect(markup).not.toContain('inert=""');
    expect(markup).not.toContain("aria-expanded");
  });

  it("收起时只有可中断的任务提供停止入口", () => {
    expect(renderComposer(true, true)).toContain('aria-label="停止生成"');
    expect(renderComposer(true, false)).not.toContain('aria-label="停止生成"');
    expect(renderComposer(false, true)).not.toContain('aria-label="停止生成"');
  });

  it("分屏内无底栏的定时任务编辑器保持展开", () => {
    const markup = renderComposer(true, false, false);
    expect(markup).not.toContain('hidden=""');
    expect(markup).not.toContain("aria-expanded");
  });
});
