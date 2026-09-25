import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { AppendOnlyTextBuffer } from "../../lib/append-only-text.js";
import { MessageResponse } from "./message-response.js";

const source = "- **持续对话： **使用 `query()` 配合 [Streaming Input](https://example.com)\n- **精确恢复：**记录原生 `sessionId`";

describe("MessageResponse bold boundaries", () => {
  it.each(["static", "streaming"] as const)("renders Chinese labels in %s mode", async (mode) => {
    const screen = await render(<MessageResponse mode={mode}>{source}</MessageResponse>);
    expect(Array.from(screen.container.querySelectorAll('[data-streamdown="strong"]'), (node) => node.textContent)).toEqual(["持续对话：", "精确恢复："]);
    expect(screen.container.textContent).not.toContain("**");
    expect(screen.container.querySelector("code")?.textContent).toBe("query()");
    expect(screen.container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/");
  });

  it("repairs labels arriving across streaming snapshots", async () => {
    const buffer = new AppendOnlyTextBuffer("- **持续对话：");
    const screen = await render(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" isAnimating />);
    for (const chunk of [" ", "*", "*", "使用 `query()`"]) {
      buffer.append(chunk);
      await screen.rerender(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" isAnimating />);
    }
    expect(screen.container.querySelector('[data-streamdown="strong"]')?.textContent).toBe("持续对话：");
    expect(screen.container.textContent).not.toContain("**");
    await screen.rerender(<MessageResponse textSource={buffer.getSnapshot()} mode="static" isAnimating={false} />);
    expect(screen.container.querySelector('[data-streamdown="strong"]')?.textContent).toBe("持续对话：");
  });

  it("preserves code and escaped literal markers", async () => {
    const screen = await render(<MessageResponse mode="static">{"`**持续对话： **`\n\n```text\n**持续对话： **\n```\n\n\\*\\*持续对话： \\*\\*"}</MessageResponse>);
    expect(screen.container.querySelector('[data-streamdown="strong"]')).toBeNull();
    expect(screen.container.querySelector("code")?.textContent).toBe("**持续对话： **");
  });
});
