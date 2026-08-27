import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workbenchCss = readFileSync(new URL("./workbench.css", import.meta.url), "utf8");
const codeCommentsSource = readFileSync(
  new URL("../components/agent/code-comments.tsx", import.meta.url),
  "utf8",
);
const promptControlsSource = readFileSync(
  new URL("../components/agent/prompt-input-controls.tsx", import.meta.url),
  "utf8",
);

describe("工作台背景浮层", () => {
  it("在背景图片加载后将浮层表面统一为 95% 不透明", () => {
    expect(workbenchCss).toMatch(
      /--ui-color-floating-surface:\s*color-mix\(\s*in oklab,\s*var\(--ui-color-wallpaper-overlay\) 95%,\s*transparent\s*\);/u,
    );
    expect(workbenchCss).toContain("--ui-color-dialog: var(--ui-color-floating-surface);");
    expect(workbenchCss).toContain('[data-slot="dialog-content"]');
    expect(workbenchCss).toContain('[data-slot="sheet-content"]');
    expect(workbenchCss).toContain('[data-slot="tooltip-content"]');
    expect(workbenchCss).toContain('[data-slot="dropdown-menu-content"]');
    expect(workbenchCss).toContain('[data-slot="context-menu-content"]');
    expect(workbenchCss).toContain('[data-slot="select-content"]');
    expect(workbenchCss).toContain("[data-sonner-toast]");
    expect(workbenchCss).toContain(".workbench-pet-bubble-button");
    expect(workbenchCss).toContain("background: var(--ui-color-floating-surface) !important;");
    expect(codeCommentsSource).toContain("data-floating-surface");
    expect(promptControlsSource).toContain("data-floating-surface");
  });
});
