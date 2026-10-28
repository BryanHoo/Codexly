import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConversationList } from "./conversation.js";

describe("ConversationList rendering", () => {
  it("服务端渲染全部已加载回合并保留稳定消息身份", () => {
    const markup = renderToStaticMarkup(
      createElement(ConversationList, {
        conversationId: "task-a",
        getItemKey: (turnId: unknown) => String(turnId),
        items: Array.from({ length: 100 }, (_, index) => `turn-${String(index)}`),
        renderItem: (turnId: unknown) => createElement("p", null, String(turnId)),
      }),
    );

    expect(markup).toContain('data-conversation-content=""');
    expect(markup).toContain("<p>turn-99</p>");
    expect(markup).toContain('data-slot="message-scroller-item"');
    expect(markup).not.toContain("transform:");
    expect(markup).toContain("content-visibility:auto");
  });
});
