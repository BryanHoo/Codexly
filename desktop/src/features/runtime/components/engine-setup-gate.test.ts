import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { useSelectedEngines } from "@codexly/ui/core/engine-selection";
const state = vi.hoisted(() => ({ engines: [] as ("codex" | "claude")[] }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: state.engines, isError: false }),
}));
vi.mock("../../../i18n/i18n.js", () => ({ getCurrentLanguage: () => "zh-CN" }));
import { EngineSetupGate } from "./engine-setup-gate.js";
function Workspace() {
  return createElement("main", { "data-engines": useSelectedEngines()?.join(",") }, "工作区");
}
it.each([[], ["codex"], ["claude"], ["codex", "claude"]] as const)(
  "renders workspace directly with only configured engines: %j", (...engines) => {
    state.engines = [...engines];
    const html = renderToStaticMarkup(createElement(EngineSetupGate, null, createElement(Workspace)));
    expect(html).toContain("工作区");
    expect(html).toContain(`data-engines="${engines.join(",")}"`);
    expect(html).not.toMatch(/选择|下载|安装/);
  },
);
