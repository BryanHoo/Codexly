import { describe, expect, it, vi } from "vitest";

import { openMarkdownLink } from "./markdown-link-navigation.js";

describe("Markdown link navigation", () => {
  it("opens web links with the system URL opener", () => {
    const preventDefault = vi.fn();
    const openExternalUrl = vi.fn(async () => undefined);

    openMarkdownLink({ preventDefault }, "https://example.com/docs?q=markdown", openExternalUrl);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/docs?q=markdown");
  });

  it("keeps document anchors inside the WebView", () => {
    const preventDefault = vi.fn();
    const openExternalUrl = vi.fn(async () => undefined);

    openMarkdownLink({ preventDefault }, "#details", openExternalUrl);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(openExternalUrl).not.toHaveBeenCalled();
  });
});
