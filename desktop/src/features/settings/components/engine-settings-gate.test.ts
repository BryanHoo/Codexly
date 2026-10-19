import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("../../../i18n/i18n.js", () => ({ getCurrentLanguage: () => "zh-CN" }));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SelectedEnginesContext } from "@codexly/ui/core/engine-selection";
import { EngineSettingsGate } from "./engine-settings-gate.js";
it.each(["codex", "claude"] as const)("opens %s configuration without an enable or install step", (engine) => {
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SelectedEnginesContext, { value: [] }, createElement(EngineSettingsGate, { engine }, createElement("input", { "aria-label": "API Key" })))));
  expect(html).toContain("API Key");
  expect(html).not.toMatch(/下载|启用|安装/);
});
