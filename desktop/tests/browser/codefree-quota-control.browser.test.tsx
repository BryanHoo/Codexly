import type { ComponentProps } from "react";
import { WorkbenchComposerFooter as WebFooter } from "../../../apps/web/src/features/workbench/components/workbench-composer-footer.js";
import { WorkbenchComposerFooter as DesktopFooter } from "../../src/features/workbench/components/workbench-composer-footer.js";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { AgentQuotaControl } from "@codexly/ui/core/agent-quota-control";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AcpAgentProfile, CodefreeQuotaView } from "@codexly/protocol";

it.each(["web", "desktop"] as const)(
  "%s 在上下文左侧打开额度，并在重新打开时刷新",
  async (platform) => {
    const getAgentQuota = vi
      .fn<() => Promise<CodefreeQuotaView>>()
      .mockResolvedValueOnce({ fiveHour: 0, sevenDay: 82.5, reason: null })
      .mockResolvedValueOnce({ fiveHour: null, sevenDay: null, reason: "OUTSIDE_GRAY_SCOPE" });
    const query = new QueryClient();
    const getAcpAgent = async (): Promise<AcpAgentProfile> => ({
      engine: "acp-codefree-o",
      protocolVersion: 1,
      authMethods: [],
      authStatus: { kind: "account", label: "CodeFree O" },
    });
    query.setQueryData(["acp-agent-profile", "acp-codefree-o"], await getAcpAgent());
    const footerProps = {
      footerVisible: true,
      captureMode: true,
      projectToolsEnabled: false,
      contextUsage: { usedTokens: 100, contextWindow: 1000 },
      acp: {
        quotaControl: (
          <AgentQuotaControl
            engine="acp-codefree-o"
            client={{ getAgentQuota, getAcpAgent }}
            language="zh-CN"
          />
        ),
      },
    };
    const common = { rootControls: null, controls: null, collapsed: false };
    const screen = await render(
      <QueryClientProvider client={query}>
        {platform === "web" ? (
          <WebFooter {...common} props={footerProps as ComponentProps<typeof WebFooter>["props"]} />
        ) : (
          <DesktopFooter
            {...common}
            props={footerProps as ComponentProps<typeof DesktopFooter>["props"]}
          />
        )}
      </QueryClientProvider>,
    );
    const buttons = document.querySelectorAll(".workbench-status-bar button");
    expect(buttons[0]?.getAttribute("aria-label")).toBe("CodeFree O 剩余额度");
    expect(buttons[0]?.textContent).toBe("");
    expect(buttons[0]?.querySelector("svg")).not.toBeNull();
    expect(buttons[1]?.textContent).toContain("10%");
    const trigger = screen.getByRole("button", { name: "CodeFree O 剩余额度" });
    expect(getAgentQuota).not.toHaveBeenCalled();
    await trigger.click();
    await expect
      .element(screen.getByRole("progressbar", { name: "5 小时" }))
      .toHaveAttribute("aria-valuenow", "0");
    await expect
      .element(screen.getByRole("progressbar", { name: "7 天" }))
      .toHaveAttribute("aria-valuenow", "82.5");
    await userEvent.keyboard("{Escape}");
    await trigger.click();
    await expect.element(screen.getByText("当前账号未纳入额度灰度范围")).toBeVisible();
    expect(getAgentQuota).toHaveBeenCalledTimes(2);
  },
);

it.each(["codex", "claude", "acp-opencode"] as const)(
  "%s 随账号登录与自定义 API 切换额度图标",
  async (engine) => {
    const query = new QueryClient();
    const key = ["acp-agent-profile", engine];
    const profile: AcpAgentProfile = { engine, protocolVersion: 1, authMethods: [] };
    const signedIn: AcpAgentProfile = {
      ...profile,
      authStatus: { kind: "account", label: "订阅账号" },
    };
    query.setQueryData(key, { ...profile, authStatus: { kind: "none", label: "未登录" } });
    const client = {
      getAcpAgent: vi.fn(async () => profile),
      getAgentQuota: vi.fn(async () => ({ fiveHour: 40, sevenDay: 60, reason: null })),
    };
    const screen = await render(
      <QueryClientProvider client={query}>
        <AgentQuotaControl client={client} engine={engine} language="zh-CN" />
      </QueryClientProvider>,
    );
    const trigger = screen.getByRole("button", { name: /剩余额度$/u });
    await expect.element(trigger).not.toBeInTheDocument();
    expect(client.getAgentQuota).not.toHaveBeenCalled();
    query.setQueryData(key, signedIn);
    await trigger.click();
    await expect.element(screen.getByText("40%")).toBeVisible();
    query.setQueryData(key, {
      ...signedIn,
      connection: { source: "native", apiType: "openai", hasCredentials: true },
    });
    await expect.element(trigger).not.toBeInTheDocument();
    await expect.element(screen.getByText("40%")).not.toBeInTheDocument();
    query.setQueryData(key, { ...profile, authStatus: { kind: "api_key", label: "API Key" } });
    await expect.element(trigger).not.toBeInTheDocument();
    query.setQueryData(key, signedIn);
    await expect.element(trigger).toBeVisible();
    expect(client.getAgentQuota).toHaveBeenCalledTimes(1);
    await screen.unmount();
    query.clear();
  },
);

it("额度查询中切换界面语言时沿用原请求", async () => {
  const query = new QueryClient();
  const engine = "acp-codefree-o";
  const profile: AcpAgentProfile = {
    engine,
    protocolVersion: 1,
    authMethods: [],
    authStatus: { kind: "account", label: "CodeFree O" },
  };
  query.setQueryData(["acp-agent-profile", engine], profile);
  const pending = Promise.withResolvers<CodefreeQuotaView>();
  const client = {
    getAcpAgent: async () => profile,
    getAgentQuota: vi.fn((_engine: string, _options: { signal: AbortSignal }) => pending.promise),
  };
  const control = (language: string) => (
    <QueryClientProvider client={query}>
      <AgentQuotaControl client={client} engine={engine} language={language} />
    </QueryClientProvider>
  );
  const screen = await render(control("zh-CN"));
  await screen.getByRole("button", { name: "CodeFree O 剩余额度" }).click();
  await expect.poll(() => client.getAgentQuota.mock.calls.length).toBe(1);
  const signal = client.getAgentQuota.mock.calls[0]?.[1].signal;

  await screen.rerender(control("en-US"));
  await expect.element(screen.getByText("Loading quota…")).toBeVisible();
  pending.resolve({ fiveHour: 42, sevenDay: null, reason: null });
  await expect.element(screen.getByRole("progressbar", { name: "5 hours" })).toHaveAttribute(
    "aria-valuenow",
    "42",
  );
  expect(client.getAgentQuota).toHaveBeenCalledOnce();
  expect(signal?.aborted).toBe(false);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => signal?.aborted).toBe(true);
  query.clear();
});
