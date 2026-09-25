import type { PendingRequest } from "@/protocol/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import "../../../shared/styles/globals.css";
import "../../../shared/styles/official-plugins.css";
import "../../../shared/styles/workbench.css";
import { openExternalUrl } from "../../../platform/tauri/external-url.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { McpElicitationRequestCard } from "./mcp-elicitation-request.js";
import { PluginInstallSuggestionCard } from "./plugin-install-suggestion-card.js";

vi.mock("../../../platform/tauri/external-url.js", () => ({
  openExternalUrl: vi.fn(),
}));

const urlRequest = {
  createdAt: "2026-08-30T01:00:00.000Z",
  expiresAt: null,
  itemId: "mcp-elicitation:request-1",
  message: "完成账户授权",
  mode: "url",
  projectId: "codeagent",
  requestId: "request-1",
  serverName: "docs",
  status: "pending",
  taskId: "task-1",
  turnId: "turn-1",
  type: "mcp_elicitation",
  url: "https://auth.example.com/oauth/authorize?client_id=codeagent",
} as const satisfies PendingRequest;

function TestProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{children}</TooltipProvider>
    </I18nextProvider>
  );
}

describe("MCP URL elicitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays the destination and resolves only after the system browser opens", async () => {
    await i18n.changeLanguage("zh-CN");
    let finishOpen: (() => void) | undefined;
    vi.mocked(openExternalUrl).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishOpen = resolve;
        }),
    );
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <TestProviders>
        <McpElicitationRequestCard
          interactive
          onResolve={onResolve}
          request={urlRequest}
        />
      </TestProviders>,
    );

    await expect.element(screen.getByText("auth.example.com", { exact: true })).toBeVisible();
    await expect.element(screen.getByText(urlRequest.url, { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "同意并打开链接" }).click();

    expect(openExternalUrl).toHaveBeenCalledWith(urlRequest.url);
    expect(onResolve).not.toHaveBeenCalled();
    finishOpen?.();
    await vi.waitFor(() => {
      expect(onResolve).toHaveBeenCalledOnce();
    });
    expect(onResolve.mock.calls[0]?.[1]).toEqual({ action: "accept" });
  });

  it("does not resolve when opening the system browser fails", async () => {
    await i18n.changeLanguage("zh-CN");
    vi.mocked(openExternalUrl).mockRejectedValueOnce(new Error("open failed"));
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <TestProviders>
        <McpElicitationRequestCard
          interactive
          onResolve={onResolve}
          request={urlRequest}
        />
      </TestProviders>,
    );

    await screen.getByRole("button", { name: "同意并打开链接" }).click();
    await vi.waitFor(() => {
      expect(openExternalUrl).toHaveBeenCalledWith(urlRequest.url);
    });
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("disables navigation for non-Web URL protocols", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <TestProviders>
        <McpElicitationRequestCard
          interactive
          onResolve={vi.fn().mockResolvedValue(undefined)}
          request={{ ...urlRequest, url: "javascript:alert(document.domain)" }}
        />
      </TestProviders>,
    );

    await expect.element(screen.getByText("URL 无效，无法打开")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "同意并打开链接" })).toBeDisabled();
  });
});

describe("plugin install suggestion", () => {
  it("keeps approval inline and opens supplemental details on the right", async () => {
    await i18n.changeLanguage("zh-CN");
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const request = {
      connectorCount: 1,
      createdAt: "2026-09-06T01:00:00.000Z",
      expiresAt: null,
      installUrl: null,
      itemId: "plugin-install:request-2",
      pluginName: "GitHub",
      projectId: "codeagent",
      remoteMarketplaceName: "openai-curated-remote",
      remotePluginId: "plugins~Plugin_github",
      requestId: "request-2",
      status: "pending",
      suggestReason: "读取仓库和 Pull Request",
      suggestionId: "request_plugin_install_call-2",
      taskId: "task-1",
      toolId: "github@openai-curated-remote",
      toolType: "plugin",
      turnId: "turn-1",
      type: "plugin_install_suggestion",
    } as const satisfies PendingRequest;
    const screen = await render(
      <TestProviders>
        <PluginInstallSuggestionCard interactive onResolve={onResolve} request={request} />
      </TestProviders>,
    );

    await expect.element(screen.getByText("Codex 建议安装 GitHub")).toBeVisible();
    await expect.element(screen.getByText("1 个连接器")).toBeVisible();
    await screen.getByRole("button", { name: "查看详情" }).click();
    await expect.element(screen.getByRole("dialog", { name: "GitHub" })).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    const sheetActions = [...document.querySelectorAll(
      ".plugin-install-suggestion__sheet-footer button",
    )];
    expect(sheetActions).toHaveLength(2);
    await vi.waitFor(() => {
      for (const action of sheetActions) {
        const bounds = action.getBoundingClientRect();
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
      }
    });
    await page.screenshot({ path: "../../../../test-results/plugin-install-suggestion.png" });
    await screen.getByRole("button", { name: "关闭" }).click();
    await screen.getByRole("button", { name: "更多操作" }).click();
    await screen.getByRole("menuitem", { name: "不再推荐" }).click();
    await vi.waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith(
        request,
        { action: "decline", suppressFuture: true },
        expect.any(String),
      );
    });
  });

  it("waits for connector setup confirmation before accepting", async () => {
    await i18n.changeLanguage("zh-CN");
    vi.mocked(openExternalUrl).mockResolvedValueOnce(undefined);
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const request = {
      connectorCount: 1,
      createdAt: "2026-09-06T01:00:00.000Z",
      expiresAt: null,
      installUrl: "https://example.test/install",
      itemId: "plugin-install:request-3",
      pluginName: "Google Calendar",
      projectId: "codeagent",
      remoteMarketplaceName: "openai-curated-remote",
      remotePluginId: null,
      requestId: "request-3",
      status: "pending",
      suggestReason: "读取日历事件",
      suggestionId: "request_plugin_install_call-3",
      taskId: "task-1",
      toolId: "connector_google_calendar",
      toolType: "connector",
      turnId: "turn-1",
      type: "plugin_install_suggestion",
    } as const satisfies PendingRequest;
    const screen = await render(
      <TestProviders>
        <PluginInstallSuggestionCard interactive onResolve={onResolve} request={request} />
      </TestProviders>,
    );

    await screen.getByRole("button", { name: "打开安装页" }).click();
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.test/install");
    expect(onResolve).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "已完成，继续" }).click();
    await vi.waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith(
        request,
        { action: "accept" },
        expect.any(String),
      );
    });
  });
});
