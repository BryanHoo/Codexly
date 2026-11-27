import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { AcpAgentProfile, AcpAuthElicitationRequest, AcpAuthElicitationResponse } from "@codexly/protocol";
import { AcpAuthSettings, type AcpAuthClient } from "@codexly/ui/core/acp-auth-settings";

const engine = "acp-codefree-o";
const authorizationUrl = "https://www.srdcloud.cn/login/oauth/authorize?state=fixture";

it.each(["web", "desktop"] as const)("%s 的 CodeFree O 登录复用原生授权页并显示回调状态", async (platform) => {
  const finish = Promise.withResolvers<Record<string, never>>();
  let signedIn = false;
  const profile: AcpAgentProfile = {
    engine, protocolVersion: 1, authMethods: [{ id: "codefree-browser", name: "CodeFree O" }],
  };
  const authenticate = vi.fn<AcpAuthClient["authenticateAcpAgent"]>(() => finish.promise);
  const request = vi.fn((_engine: string, input: AcpAuthElicitationRequest): Promise<AcpAuthElicitationResponse> => {
    if ("requestId" in input && input.requestId === "form") {
      return Promise.resolve([]);
    }
    const question = {
      type: "mcp_elicitation", acp: true, status: "pending",
      projectId: "acp-settings", taskId: engine, turnId: input.attemptId,
      itemId: "auth", createdAt: "2026-11-26T00:00:00Z", expiresAt: null,
      serverName: "CodeFree O", message: "授权说明占位",
    } as const;
    return Promise.resolve([{
      ...question, mode: "form", requestId: "form",
      fields: [{ id: "code", title: "授权码", type: "string", description: null, required: true, defaultValue: null, format: null, maxLength: 4096, minLength: 1 }],
    }, { ...question, status: "resolved", mode: "url", requestId: "url", url: authorizationUrl, externalStatus: "opened" }]);
  });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const openExternalUrl = vi.fn();
  const queryClient = new QueryClient();
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <AcpAuthSettings
        client={{ authenticateAcpAgent: authenticate, acpAuthElicitation: request,
          getAcpAgent: () => Promise.resolve({ ...profile, authStatus: { kind: signedIn ? "account" : "none", label: "CodeFree O" } }), }}
        engine={engine} language="zh-CN" openExternalUrl={platform === "desktop" ? openExternalUrl : undefined}
      />
    </QueryClientProvider>,
  );
  try {
    const status = screen.getByRole("status", { name: "连接状态", exact: true });
    await expect.element(status).toHaveTextContent("未登录");
    await screen.getByRole("button", { name: "在浏览器中登录", exact: true }).click();
    const input = screen.getByRole("textbox", { name: "授权码", exact: true });
    await expect.element(input).toBeVisible();
    expect(open).not.toHaveBeenCalled();
    expect(openExternalUrl).not.toHaveBeenCalled();
    await expect.element(screen.getByRole("button", { name: "重新打开授权页", exact: true })).toBeVisible();
    await expect.element(screen.getByText("授权说明占位")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "同意并打开" })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("combobox", { name: "登录方式" })).toBeVisible();
    await input.fill("fixture-code");
    await screen.getByRole("button", { name: "提交", exact: true }).click();
    const attemptId = authenticate.mock.calls[0]?.[2]?.attemptId;
    expect(request).toHaveBeenCalledWith(engine, { attemptId, requestId: "form", resolution: { action: "accept", content: { code: "fixture-code" } } });
    signedIn = true;
    finish.resolve({});
    await expect.element(input).not.toBeInTheDocument();
    await expect.element(status).toHaveTextContent(/^已连接$/u);
    await expect.element(status).toHaveAttribute("title", "CodeFree O");
  } finally {
    finish.resolve({});
    await screen.unmount();
    queryClient.clear();
    open.mockRestore();
  }
});
