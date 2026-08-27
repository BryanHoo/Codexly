import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("全局滚动条", () => {
  it("在 Firefox 与 Chromium 上使用 macOS 风格", () => {
    expect(globalsCss).toContain("scrollbar-width: thin;");
    expect(globalsCss).toContain("scrollbar-color: var(--ui-color-scrollbar-thumb) transparent;");
    expect(globalsCss).toContain("*::-webkit-scrollbar {");
    expect(globalsCss).toContain("width: var(--ui-scrollbar-size);");
    expect(globalsCss).toContain("*::-webkit-scrollbar-track,");
    expect(globalsCss).toContain("*::-webkit-scrollbar-corner {");
    expect(globalsCss).toContain("background: transparent;");
    expect(globalsCss).toContain("*::-webkit-scrollbar-thumb {");
    expect(globalsCss).toContain("border-radius: var(--ui-radius-pill);");
    expect(globalsCss).toContain("background-clip: padding-box;");
    expect(globalsCss).toContain("*::-webkit-scrollbar-thumb:hover {");
  });
});
