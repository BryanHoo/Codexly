import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { TaskTimelineNavigation } from "./task-timeline-navigation.js";

// 此用例校验启用后的目录布局，默认关闭与实时切换由浏览器集成测试覆盖。
vi.mock("@codexly/ui/core/conversation-display-preferences", () => ({
  useConversationDisplayPreference: () => true,
}));

describe("TaskTimelineNavigation", () => {
  it("renders a bounded window of accessible navigation markers in document order", () => {
    const items = Array.from({ length: 4096 }, (_, index) => ({
      anchorId: `message-${String(index)}`,
      preview: `Message ${String(index + 1)}`,
      turnIndex: index,
    }));
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(TaskTimelineNavigation, {
          items,
          onNavigate: vi.fn(),
          scrollContainerRef: createRef<HTMLDivElement>(),
          scrollbarWidth: 0,
        }),
      ),
    );

    const mounted = markup.match(/data-timeline-navigation-item=/gu)?.length ?? 0;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(100);
    expect(markup).toContain('aria-label="跳转到用户消息 1"');
    expect(markup.indexOf('data-index="0"')).toBeLessThan(markup.indexOf('data-index="1"'));
    expect(markup).not.toContain('data-index="4095"');
  });
});
