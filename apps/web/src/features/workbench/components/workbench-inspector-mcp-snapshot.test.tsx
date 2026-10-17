import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { McpServerSection } from "./workbench-inspector-sections.js";

it("shows cached empty MCP snapshots with observation time and three distinct actions", () => {
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
  for (const key of [
    "mcpCached",
    "mcpUnknownTime",
    "mcpRefresh",
    "mcpReconnect",
    "mcpReloadConfig",
  ] as const)
    expect(unknown).toContain(i18n.t(`inspector.${key}`, { ns: "conversation" }));
  const known = render("2026-10-17T08:00:00.000Z", true);
  expect(known).toContain('dateTime="2026-10-17T08:00:00.000Z"');
  expect(known).not.toContain(i18n.t("inspector.mcpUnknownTime", { ns: "conversation" }));
  expect(known.match(/disabled=""/g)).toHaveLength(3);
});
