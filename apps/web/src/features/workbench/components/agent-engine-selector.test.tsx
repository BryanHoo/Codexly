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

  it.each([false, true])("双引擎仅在未固定会话引擎时显示，已固定：%s", (locked) => {
    const markup = renderToStaticMarkup(
      <AgentEngineSelector
        codexAvailable
        claudeAvailable
        value="claude"
        locked={locked}
        label="执行引擎"
        onChange={vi.fn()}
      />,
    );
    if (locked) {
      expect(markup).toBe("");
      return;
    }
    expect(markup).toContain('aria-label="执行引擎"');
    expect(markup).toContain("Claude");
    expect(markup).not.toContain("Claude Agent");
    expect(markup).not.toContain('disabled=""');
  });
});
