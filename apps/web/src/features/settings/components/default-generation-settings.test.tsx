import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DefaultGenerationSettings } from "@codexly/ui/core/default-generation-settings";
import { SelectedEnginesContext } from "@codexly/ui/core/engine-selection";
import type { AgentEngine } from "@codexly/protocol";

function render(engines: readonly AgentEngine[]) {
  return renderToStaticMarkup(
    <SelectedEnginesContext value={engines}>
      <DefaultGenerationSettings
        settings={{ defaultAgent: "codex", defaultModel: "gpt-6-luna" }}
        language="zh-CN"
        getModels={vi.fn()}
        onChange={vi.fn()}
      />
    </SelectedEnginesContext>,
  );
}

it("shows the agent selector only when both agents are enabled", () => {
  expect(render(["codex", "claude"])).toContain('aria-label="默认 Agent"');
  for (const engine of ["codex", "claude"] as const) {
    const html = render([engine]);
    expect(html).not.toContain('aria-label="默认 Agent"');
    expect(html).toContain('aria-label="默认模型"');
    expect(html).toContain(engine === "codex" ? "gpt-6-luna" : "haiku");
  }
});
