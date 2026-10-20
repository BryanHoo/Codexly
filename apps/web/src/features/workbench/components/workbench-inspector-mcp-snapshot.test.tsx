import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { McpServerSection } from "./workbench-inspector-sections.js";

it("空快照保留紧凑操作入口，隐藏缓存状态、观测时间和未展开的次要操作", () => {
  const render = (observedAt: string | null, isRetrying = false) =>
    renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(McpServerSection, {
          statusSource: "cached",
          observedAt,
          canRetry: true,
          isRefreshing: false,
          isRetrying,
          servers: [],
          onRetry: () => undefined,
        }),
      ),
    );
  const unknown = render(null);
  for (const key of ["mcpRefresh", "mcpMore", "mcpEmpty"] as const)
    expect(unknown).toContain(i18n.t(`inspector.${key}`, { ns: "conversation" }));
  for (const key of ["mcpCached", "mcpUnknownTime", "mcpReconnect", "mcpReloadConfig"] as const)
    expect(unknown).not.toContain(i18n.t(`inspector.${key}`, { ns: "conversation" }));
  const known = render("2026-10-17T08:00:00.000Z", true);
  expect(known).not.toContain("<time");
  expect(known).toContain('aria-busy="true"');
  expect(known.match(/disabled=""/g)).toHaveLength(2);
});
