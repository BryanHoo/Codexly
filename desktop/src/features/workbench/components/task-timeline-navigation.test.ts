import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { TaskTimelineNavigation } from "./task-timeline-navigation.js";

describe("TaskTimelineNavigation", () => {
  it("renders every navigation marker in natural document order", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
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

    expect(markup.match(/data-timeline-navigation-item=/gu)).toHaveLength(items.length);
    expect(markup).toContain('data-index="19"');
    expect(markup.indexOf('data-index="0"')).toBeLessThan(markup.indexOf('data-index="19"'));
    expect(markup).not.toContain("position:absolute");
    expect(markup).not.toContain("translateY(");
  });
});
