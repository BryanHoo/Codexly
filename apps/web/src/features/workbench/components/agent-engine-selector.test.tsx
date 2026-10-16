import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentEngineSelector } from "@codexly/ui/core/agent-engine-controls";

describe("执行引擎选择器", () => {
  it.each([
    [true, false],
    [false, true],
    [false, false],
  ])("仅在双引擎配置完整时显示：Codex=%s Claude=%s", (codexAvailable, claudeAvailable) => {
    for (const locked of [false, true]) {
      expect(
        renderToStaticMarkup(
          <AgentEngineSelector
            codexAvailable={codexAvailable}
            claudeAvailable={claudeAvailable}
            value="codex"
            locked={locked}
            label="执行引擎"
            onChange={vi.fn()}
          />,
        ),
      ).toBe("");
    }
  });

  it("双引擎已配置时显示选择器，已有会话仍锁定选择", () => {
    const markup = renderToStaticMarkup(
      <AgentEngineSelector
        codexAvailable
        claudeAvailable
        value="claude"
        locked
        label="执行引擎"
        onChange={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="执行引擎"');
    expect(markup).toContain("Claude Agent");
    expect(markup).toContain('disabled=""');
  });
});
