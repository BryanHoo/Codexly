import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { McpServerSection } from "./workbench-inspector-sections.js";

describe("McpServerSection", () => {
  it("renders the authoritative current-task MCP states as a compact summary", () => {
    const statuses = [
      "connected",
      "starting",
      "authenticationRequired",
      "failed",
      "notStarted",
      "disabled",
      "cancelled",
      "unknown",
    ] as const;
    const renderStatus = (status: (typeof statuses)[number], index: number) => {
      const server = {
        displayName: `Server ${index + 1}`,
        name: `server-${index + 1}`,
        status,
        toolCount: index,
      } as const;
      return renderToStaticMarkup(
        createElement(
          TooltipProvider,
          null,
          createElement(McpServerSection, {
            canRetry: true,
            isRefreshing: false,
            isRetrying: false,
            onRetry: () => undefined,
            servers: [server],
          }),
        ),
      );
    };

    for (const [index, status] of statuses.entries()) {
      const markup = renderStatus(status, index);
      expect(markup).toContain(i18n.t(`inspector.mcpStatus.${status}`, { ns: "conversation" }));
      expect(markup).toContain(
        i18n.t("inspector.mcpToolCount", { count: index, ns: "conversation" }),
      );
      expect(markup).not.toContain("认证状态未知");
    }
  });
});
