import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import {
  createCustomProviderInput,
  hasIncompleteCustomModels,
  ProviderConnectionPanelView,
} from "./provider-connection-panel.js";

const handlers = {
  onApiKeyChange: vi.fn(),
  onBaseUrlChange: vi.fn(),
  onCancelLogin: vi.fn(),
  onConfigureCustom: vi.fn(),
  onLogout: vi.fn(),
  onAddModel: vi.fn(),
  onModelChange: vi.fn(),
  onRemoveModel: vi.fn(),
  onModeChange: vi.fn(),
  onRetry: vi.fn(),
  onStartOfficialLogin: vi.fn(),
};

function renderWithTooltipProvider(children: ReactNode): string {
  return renderToStaticMarkup(<TooltipProvider>{children}</TooltipProvider>);
}

describe("ProviderConnectionPanelView", () => {
  beforeEach(async () => {
    await changeAppLanguage("zh-CN");
  });

  it("renders a pending official login with a cancellable status", () => {
    const markup = renderWithTooltipProvider(
      <ProviderConnectionPanelView
        {...handlers}
        apiKey=""
        baseUrl=""
        error={null}
        isBusy={false}
        mode="official"
        models={[]}
        status={{
          account: null,
          customBaseUrl: null,
          mode: "official",
          pendingLogin: { error: null, loginId: "login-1", state: "pending" },
          state: "pending",
        }}
      />,
    );

    expect(markup).toContain("等待浏览器登录");
    expect(markup).toContain("取消登录");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("inline-flex h-10 items-center justify-center gap-2");
    expect(markup).not.toContain("min-h-56");
    expect(markup).not.toContain('name="custom-models"');
  });

  it("renders accessible transient custom API fields and connected state", () => {
    const markup = renderWithTooltipProvider(
      <ProviderConnectionPanelView
        {...handlers}
        apiKey=""
        baseUrl="https://api.example.com/v1"
        error={null}
        isBusy={false}
        mode="custom"
        models={[
          { id: "manual-model", key: "model-1", name: "Manual Model" },
          { id: "other-model", key: "model-2", name: "Other Model" },
        ]}
        status={{
          account: { type: "apiKey" },
          customBaseUrl: "https://api.example.com/v1",
          mode: "custom",
          pendingLogin: null,
          state: "connected",
        }}
      />,
    );

    expect(markup).toContain('type="url"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="new-password"');
    expect(markup).toContain("自定义模型（可选）");
    expect(markup).toContain('value="manual-model"');
    expect(markup).toContain('value="Manual Model"');
    expect(markup).toContain('data-variant="outline"');
    expect(markup).toContain("重新连接");
    expect(markup).toContain("已连接");
  });

  it("builds structured models and rejects incomplete rows", () => {
    expect(
      createCustomProviderInput({
        apiKey: "",
        baseUrl: " https://api.example.com/v1 ",
        models: [{ id: " alpha ", key: "model-1", name: " Alpha Model " }],
      }),
    ).toEqual({
      baseUrl: "https://api.example.com/v1",
      models: [{ id: "alpha", name: "Alpha Model" }],
    });
    expect(hasIncompleteCustomModels([{ id: "alpha", key: "model-1", name: "" }])).toBe(true);
    expect(hasIncompleteCustomModels([])).toBe(false);
  });
});
