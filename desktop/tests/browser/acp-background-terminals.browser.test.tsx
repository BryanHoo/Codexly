import { useLayoutEffect } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBackgroundTerminals as useWeb } from "../../../apps/web/src/features/workbench/hooks/use-background-terminals.js";
import { useBackgroundTerminals as useNative } from "../../src/features/workbench/hooks/use-background-terminals.js";

for (const [platform, useTerminals] of [["Web", useWeb], ["Native", useNative]] as const) {
  it.each(["pending", "acp"] as const)(`${platform}：%s 不读取旧终端，状态变化不触发旧刷新`, async (runtime) => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    cache.setQueryData(["projects", "p", "tasks", "t", "background-terminals"], { data: [{ id: "旧命令" }] });
    const client = { listBackgroundTerminals: vi.fn(() => Promise.resolve({ data: [] })), terminateBackgroundTerminal: vi.fn() };
    let terminate: ((id: string) => Promise<void>) | undefined;
    function Probe({ running }: { running: boolean }) {
      const view = useTerminals(client, "p", "t", running, true, runtime);
      useLayoutEffect(() => { terminate = view.terminateTerminal; });
      return <output>{view.terminals.length}</output>;
    }
    const wrap = (running: boolean) => <QueryClientProvider client={cache}><Probe running={running} /></QueryClientProvider>;
    const screen = await render(wrap(true));
    expect(client.listBackgroundTerminals).not.toHaveBeenCalled();
    await expect.element(screen.getByText("0", { exact: true })).toBeVisible();
    await screen.rerender(wrap(false));
    expect(client.listBackgroundTerminals).not.toHaveBeenCalled();
    if (!terminate) throw new Error("缺少终止入口");
    await expect(terminate("旧命令")).rejects.toThrow("当前运行时不支持旧后台终端接口");
    expect(client.terminateBackgroundTerminal).not.toHaveBeenCalled();
    expect(client.listBackgroundTerminals).not.toHaveBeenCalled();
    await screen.unmount(); cache.clear();
  });
  it(`${platform}：切换到 ACP 后，保留的旧操作函数也不能终止或刷新`, async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const client = { listBackgroundTerminals: vi.fn(() => Promise.resolve({ data: [] })), terminateBackgroundTerminal: vi.fn() };
    let retained: ((id: string) => Promise<void>) | undefined;
    function Probe({ runtime }: { runtime: "legacy" | "acp" }) {
      const view = useTerminals(client, "p", "t", false, false, runtime);
      useLayoutEffect(() => { retained ??= view.terminateTerminal; });
      return null;
    }
    const wrap = (runtime: "legacy" | "acp") => <QueryClientProvider client={cache}><Probe runtime={runtime} /></QueryClientProvider>;
    const screen = await render(wrap("legacy"));
    await screen.rerender(wrap("acp"));
    if (!retained) throw new Error("缺少旧操作入口");
    await expect(retained("old")).rejects.toThrow("当前运行时不支持旧后台终端接口");
    expect(client.terminateBackgroundTerminal).not.toHaveBeenCalled(); expect(client.listBackgroundTerminals).not.toHaveBeenCalled();
    await screen.unmount(); cache.clear();
  });
  it.each(["成功", "失败"] as const)(`${platform}：已发送旧终止%s后进入 ACP，不刷新且保留实际结果`, async (outcome) => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const gate = Promise.withResolvers<{ terminals: { data: never[] } }>();
    const client = { listBackgroundTerminals: vi.fn(() => Promise.resolve({ data: [] })), terminateBackgroundTerminal: vi.fn(() => gate.promise) };
    let action: ((id: string) => Promise<void>) | undefined;
    function Probe({ runtime }: { runtime: "legacy" | "acp" }) {
      const view = useTerminals(client, "p", "t", false, false, runtime);
      useLayoutEffect(() => { action = view.terminateTerminal; });
      return null;
    }
    const wrap = (runtime: "legacy" | "acp") => <QueryClientProvider client={cache}><Probe runtime={runtime} /></QueryClientProvider>;
    const screen = await render(wrap("legacy"));
    if (!action) throw new Error("缺少终止入口");
    const done = action("first").then(() => "resolved", () => "rejected");
    await expect.poll(() => client.terminateBackgroundTerminal.mock.calls.length).toBe(1);
    await screen.rerender(wrap("acp"));
    if (outcome === "失败") gate.reject(new Error("旧终止失败"));
    else gate.resolve({ terminals: { data: [] } });
    expect(await done).toBe(outcome === "失败" ? "rejected" : "resolved");
    expect(client.terminateBackgroundTerminal).toHaveBeenCalledOnce(); expect(client.listBackgroundTerminals).not.toHaveBeenCalled();
    await screen.unmount(); cache.clear();
  });
}
