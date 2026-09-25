import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConversationList } from "./conversation.js";

describe("ConversationList rendering", () => {
  it("仅服务端渲染有界初始窗口并保持 WebKit 安全定位", () => {
    const markup = renderToStaticMarkup(
      createElement(ConversationList, {
        conversationId: "task-a",
        getItemKey: (turnId: unknown) => String(turnId),
        items: Array.from({ length: 100 }, (_, index) => `turn-${String(index)}`),
        renderItem: (turnId: unknown) => createElement("p", null, String(turnId)),
      }),
    );

    expect(markup).toContain('data-conversation-content=""');
    expect(markup).not.toContain('data-index="99"');
    expect(markup).toContain("position:relative");
    expect(markup).not.toContain("transform:");
    expect(markup).not.toContain("content-visibility");
  });
});
